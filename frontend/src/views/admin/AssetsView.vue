<template>
  <div class="assets-view">
    <nav class="admin-nav">
      <router-link to="/admin" class="admin-nav-item" exact-active-class="active">
        <LayoutDashboard :size="16" /> 概览
      </router-link>
      <router-link to="/admin/assets" class="admin-nav-item" active-class="active">
        <FolderOpen :size="16" /> 视频
      </router-link>
      <router-link to="/admin/publish" class="admin-nav-item" active-class="active">
        <Send :size="16" /> 发布
      </router-link>
    </nav>

    <header class="page-header">
      <div class="header-left">
        <h1 class="page-title">视频管理</h1>
        <span class="count-badge" v-if="total">{{ total }}</span>
      </div>
      <div class="header-actions">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索标题..."
          class="search-input"
          @input="debouncedSearch"
        />
        <button @click="showImportDialog = true" class="btn-primary">
          <Plus :size="14" /> 导入视频
        </button>
      </div>
    </header>

    <!-- Filters -->
    <div class="toolbar">
      <div class="filters">
        <button
          v-for="s in statusOptions"
          :key="s.value"
          @click="filterStatus = s.value"
          :class="{ active: filterStatus === s.value }"
          class="filter-btn"
        >{{ s.label }}</button>
      </div>
    </div>

    <!-- Horizontal Asset Cards -->
    <div class="asset-list">
      <div v-for="asset in assets" :key="asset.id" class="asset-row glass-panel">
        <!-- Thumbnail: 3:4 cover or fallback -->
        <div class="asset-thumb" @click="previewAsset = asset" title="点击预览视频">
          <img
            v-if="asset.cover34Path || asset.cover43Path"
            :src="`${API_BASE}/api/assets/${asset.id}/cover?ratio=34`"
            class="thumb-img"
            @error="($event.target as HTMLImageElement).style.display='none'"
          />
          <template v-else>
            <Video :size="20" class="thumb-icon" />
            <span class="thumb-ext">{{ getExt(asset.videoFilePath) }}</span>
          </template>
          <div class="thumb-play"><Play :size="12" /></div>
        </div>

        <!-- Info -->
        <div class="asset-info">
          <div class="info-top">
            <h3 class="asset-title">{{ asset.title }}</h3>
            <span class="status-badge" :class="asset.status">{{ statusLabels[asset.status] || asset.status }}</span>
          </div>
          <div class="info-lines">
            <div class="info-line" v-if="asset.description">
              <FileText :size="12" />
              <span>{{ truncate(asset.description, 80) }}</span>
            </div>
            <div class="info-line" v-if="asset.hashtags">
              <Tag :size="12" />
              <span>{{ asset.hashtags }}</span>
            </div>
            <div class="info-line meta-path">
              <HardDrive :size="12" />
              <span>{{ shortenPath(asset.videoFilePath) }}</span>
            </div>
          </div>
          <span class="meta-date">{{ formatDate(asset.createdAt) }}</span>
        </div>

        <!-- Cover thumbnails -->
        <div class="asset-cover-thumbs" v-if="asset.cover43Path || asset.cover34Path">
          <img
            v-if="asset.cover43Path"
            :src="`${API_BASE}/api/assets/${asset.id}/cover`"
            class="cover-thumb cover-43"
            title="4:3 封面 · 点击查看"
            @click="openCoverPreview(asset, '43')"
          />
          <img
            v-if="asset.cover34Path"
            :src="`${API_BASE}/api/assets/${asset.id}/cover?ratio=34`"
            class="cover-thumb cover-34"
            title="3:4 封面 · 点击查看"
            @click="openCoverPreview(asset, '34')"
          />
        </div>

        <!-- Actions -->
        <div class="asset-actions">
          <template v-if="asset.status === 'published' || asset.status === 'draft_saved'">
            <button @click="quickPublish(asset)" class="btn-action btn-publish">
              <Send :size="13" /> 再发布
            </button>
            <button @click="editAsset(asset)" class="btn-icon-sm" title="查看">
              <Eye :size="13" />
            </button>
          </template>
          <template v-else>
            <button @click="quickPublish(asset)" class="btn-action btn-publish" :disabled="asset.status === 'publishing'">
              <Send :size="13" /> 发布
            </button>
            <button @click="editAsset(asset)" class="btn-icon-sm" title="编辑">
              <Pencil :size="13" />
            </button>
            <button @click="handleDelete(asset.id)" class="btn-icon-sm btn-danger" title="删除">
              <Trash2 :size="13" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="!assets.length" class="empty-state">
      <Package :size="48" class="empty-icon" />
      <p class="empty-title">暂无视频</p>
      <p class="empty-hint">点击「导入视频」选择本地视频文件入库</p>
    </div>

    <!-- Import Dialog (File Browser Mode) -->
    <!-- Import Dialog -->
    <VideoFormDialog
      v-if="showImportDialog"
      mode="import"
      :video-id="selectedVideoId"
      :show-ai-toggle="importStep === 'meta'"
      @close="showImportDialog = false"
      @apply-ai="applyImportAiContent"
    >
      <template #before-form>
        <!-- Step indicator -->
        <div class="import-steps">
          <div class="step" :class="{ active: importStep === 'browse', done: importStep === 'meta' }">
            <span class="step-num">1</span> 选择文件
          </div>
          <div class="step-arrow">→</div>
          <div class="step" :class="{ active: importStep === 'meta' }">
            <span class="step-num">2</span> 填写信息
          </div>
        </div>
      </template>

      <template #form-fields>
        <!-- Step 1: File Selection -->
        <div v-if="importStep === 'browse'" class="import-browser">
          <!-- Selection cards -->
          <div class="import-selection-grid">
            <!-- Video card -->
            <div class="cover-card import-card-wide" :class="{ active: showImportBrowser && importBrowseTarget === 'video' }">
              <div class="cover-card-label">📹 视频文件</div>
              <div class="cover-card-preview" v-if="importForm.videoFilePath" @click="previewFile = importForm.videoFilePath">
                <video :src="`${API_BASE}/api/fs/preview?path=${encodeURIComponent(importForm.videoFilePath)}#t=0.5`" muted preload="metadata" class="import-video-thumb"></video>
                <span class="import-card-filename">{{ getFileName(importForm.videoFilePath) }}</span>
              </div>
              <div class="cover-card-empty" v-else>
                <Video :size="20" />
                <span>未选择</span>
              </div>
              <div class="cover-card-actions">
                <button class="btn-outline btn-xs" @click="openImportBrowserFor('video')">选择</button>
                <button v-if="importForm.videoFilePath" class="btn-outline btn-xs btn-danger" @click="importForm.videoFilePath = ''">移除</button>
              </div>
            </div>
            <!-- 4:3 cover card -->
            <div class="cover-card" :class="{ active: showImportBrowser && importBrowseTarget === '43' }">
              <div class="cover-card-label">4:3 封面</div>
              <div class="cover-card-preview" v-if="importForm.cover43FilePath" @click="previewFile = importForm.cover43FilePath">
                <img :src="`${API_BASE}/api/fs/preview?path=${encodeURIComponent(importForm.cover43FilePath)}`" />
              </div>
              <div class="cover-card-empty" v-else>
                <ImageIcon :size="20" />
                <span>可选</span>
              </div>
              <div class="cover-card-actions">
                <button class="btn-outline btn-xs" @click="openImportBrowserFor('43')">选择</button>
                <button v-if="importForm.cover43FilePath" class="btn-outline btn-xs btn-danger" @click="importForm.cover43FilePath = ''">移除</button>
              </div>
            </div>
            <!-- 3:4 cover card -->
            <div class="cover-card" :class="{ active: showImportBrowser && importBrowseTarget === '34' }">
              <div class="cover-card-label">3:4 封面</div>
              <div class="cover-card-preview" v-if="importForm.cover34FilePath" @click="previewFile = importForm.cover34FilePath">
                <img :src="`${API_BASE}/api/fs/preview?path=${encodeURIComponent(importForm.cover34FilePath)}`" />
              </div>
              <div class="cover-card-empty" v-else>
                <ImageIcon :size="20" />
                <span>可选</span>
              </div>
              <div class="cover-card-actions">
                <button class="btn-outline btn-xs" @click="openImportBrowserFor('34')">选择</button>
                <button v-if="importForm.cover34FilePath" class="btn-outline btn-xs btn-danger" @click="importForm.cover34FilePath = ''">移除</button>
              </div>
            </div>
          </div>

          <!-- Shared file browser -->
          <div v-if="showImportBrowser" class="edit-cover-browser">
            <div class="edit-browser-header">
              <span class="edit-browser-hint">正在选择 <strong>{{ importBrowseTarget === 'video' ? '视频' : importBrowseTarget === '43' ? '4:3 封面' : '3:4 封面' }}</strong>，点击文件即可选中</span>
              <button class="btn-outline btn-xs" @click="showImportBrowser = false">收起</button>
            </div>
            <div class="quick-access">
              <button v-for="qa in quickPaths" :key="qa.path" @click="importBrowseTo(qa.path)" class="qa-btn" :class="{ active: importBrowsePath === qa.path }">
                {{ qa.label }}
              </button>
            </div>

            <div class="browse-list browse-list-tall" v-if="importBrowseData">
              <!-- Parent dir always first -->
              <div v-if="importBrowseData.current !== importBrowseData.parent" class="browse-item" @click="importBrowseTo(importBrowseData.parent)">
                <FolderOpen :size="14" class="item-icon dir" /> <span>..</span>
              </div>
              <!-- When selecting video: videos first, then dirs -->
              <template v-if="importBrowseTarget === 'video'">
                <div
                  v-for="v in importBrowseFilesSorted.videos" :key="v.path"
                  class="browse-item file-item"
                  :class="{ selected: importForm.videoFilePath === v.path }"
                  @click="selectImportForTarget(v)"
                >
                  <Film :size="14" class="item-icon video" />
                  <span class="file-name">{{ v.name }}</span>
                  <span class="file-size">{{ formatSize(v.size) }}</span>
                  <button class="btn-preview" @click.stop="previewFile = v.path" title="预览">▶</button>
                  <CheckCircle v-if="importForm.videoFilePath === v.path" :size="14" class="check-icon" />
                </div>
                <div v-for="dir in importBrowseData.dirs" :key="dir.path" class="browse-item" @click="importBrowseTo(dir.path)">
                  <Folder :size="14" class="item-icon dir" /> <span>{{ dir.name }}</span>
                  <span v-if="dir.hasMedia" class="dir-media-dot" title="含媒体文件">●</span>
                </div>
              </template>
              <!-- When selecting covers: images first, then dirs -->
              <template v-else>
                <div
                  v-for="img in importBrowseFilesSorted.images" :key="img.path"
                  class="browse-item file-item"
                  :class="{ selected: importForm.cover43FilePath === img.path || importForm.cover34FilePath === img.path }"
                  @click="selectImportForTarget(img)"
                >
                  <img :src="`${API_BASE}/api/fs/preview?path=${encodeURIComponent(img.path)}`" class="browse-img-thumb" />
                  <span v-if="img.width && img.height" class="ratio-badge" :class="getAspectClass(img.width, img.height)">{{ getAspectLabel(img.width, img.height) }}</span>
                  <span class="file-name">{{ img.name }}</span>
                  <span class="file-size">{{ formatSize(img.size) }}</span>
                  <button class="btn-preview" @click.stop="previewFile = img.path" title="预览">👁</button>
                  <span v-if="importForm.cover43FilePath === img.path" class="cover-label">4:3</span>
                  <span v-if="importForm.cover34FilePath === img.path" class="cover-label">3:4</span>
                </div>
                <div v-for="dir in importBrowseData.dirs" :key="dir.path" class="browse-item" @click="importBrowseTo(dir.path)">
                  <Folder :size="14" class="item-icon dir" /> <span>{{ dir.name }}</span>
                  <span v-if="dir.hasMedia" class="dir-media-dot" title="含媒体文件">●</span>
                </div>
              </template>
              <!-- Empty -->
              <div v-if="!importBrowseData.dirs.length && !importBrowseData.videos.length && !importBrowseData.images.length" class="browse-empty">
                空文件夹
              </div>
            </div>
          </div>

          <div class="dialog-footer">
            <button @click="showImportDialog = false" class="btn-outline">取消</button>
            <button @click="importStep = 'meta'" class="btn-primary" :disabled="!importForm.videoFilePath">
              下一步 →
            </button>
          </div>
        </div>

        <!-- Step 2: Metadata -->
        <div v-if="importStep === 'meta'" class="import-meta">
          <div class="selected-summary">
            <div class="summary-item clickable" @click="previewFile = importForm.videoFilePath"><Film :size="14" /> {{ getFileName(importForm.videoFilePath) }}</div>
            <div class="summary-item clickable" v-if="importForm.cover43FilePath" @click="previewFile = importForm.cover43FilePath"><ImageIcon :size="14" /> 4:3 {{ getFileName(importForm.cover43FilePath) }}</div>
            <div class="summary-item clickable" v-if="importForm.cover34FilePath" @click="previewFile = importForm.cover34FilePath"><ImageIcon :size="14" /> 3:4 {{ getFileName(importForm.cover34FilePath) }}</div>
          </div>

          <!-- Associate with analyzed video -->
          <div class="form-group">
            <label>关联已分析视频（可选，自动填充标题/描述/标签）</label>
            <div class="searchable-select" :class="{ open: videoDropdownOpen }">
              <input
                v-model="videoSearchQuery"
                class="input"
                placeholder="搜索视频标题..."
                @focus="videoDropdownOpen = true"
                @input="videoDropdownOpen = true"
                @blur="setTimeout(() => videoDropdownOpen = false, 200)"
              />
              <button v-if="selectedVideoId" class="clear-select" @click="clearVideoSelection">✕</button>
              <div v-if="videoDropdownOpen" class="dropdown-list" @mousedown.prevent>
                <div class="dropdown-item" @click="clearVideoSelection">
                  <span style="color:#999">不关联</span>
                </div>
                <div
                  v-for="v in filteredVideos"
                  :key="v.videoId"
                  class="dropdown-item"
                  :class="{ selected: v.videoId === selectedVideoId }"
                  @click="selectVideo(v.videoId)"
                >
                  {{ v.title || v.videoId }}
                </div>
                <div v-if="!filteredVideos.length" class="dropdown-item disabled">无匹配结果</div>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>标题 *</label>
            <input v-model="importForm.title" class="input" placeholder="视频标题" />
          </div>
          <div class="form-group">
            <label>描述</label>
            <textarea v-model="importForm.description" class="input textarea" rows="20" placeholder="视频描述（可选）"></textarea>
          </div>
          <div class="form-group">
            <label>标签</label>
            <input v-model="importForm.hashtags" class="input" placeholder="标签（逗号分隔）" />
          </div>
          <div class="dialog-footer">
            <button @click="importStep = 'browse'" class="btn-outline">← 返回选文件</button>
            <span style="flex:1"></span>
            <button v-if="selectedVideoId" class="btn-ai-generate" @click="aiGenerateContent('import')" :disabled="isAIGenerating">
              <Loader2 v-if="isAIGenerating" :size="14" class="spin" />
              <Sparkles v-else :size="14" />
              {{ isAIGenerating ? 'AI 生成中...' : 'AI 生成' }}
            </button>
            <button @click="handleImport" class="btn-primary" :disabled="!importForm.title || importing">
              {{ importing ? '导入中...' : '确认导入' }}
            </button>
          </div>
        </div>
      </template>
    </VideoFormDialog>

    <!-- Edit Dialog -->
    <VideoFormDialog
      v-if="editingAsset"
      mode="edit"
      :video-id="editingAsset?.videoId"
      :show-ai-toggle="true"
      @close="editingAsset = null"
      @apply-ai="applyAiContent"
    >
      <template #form-fields>
        <div class="form-group">
          <label>视频文件</label>
          <div class="video-file-row">
            <div class="video-file-info" v-if="editForm.videoFilePath">
              <Film :size="14" />
              <span class="file-name clickable" @click="previewFile = editForm.videoFilePath">{{ getFileName(editForm.videoFilePath) }}</span>
            </div>
            <span v-else class="text-muted">未选择</span>
            <button class="btn-outline btn-xs" @click="openEditBrowserFor('video')">{{ editForm.videoFilePath ? '更换' : '选择' }}</button>
          </div>
          <div v-if="showEditBrowser && editCoverTarget === 'video'" class="edit-cover-browser">
            <div class="edit-browser-header">
              <span class="edit-browser-hint">选择视频文件</span>
              <button class="btn-outline btn-xs" @click="showEditBrowser = false">收起</button>
            </div>
            <div class="quick-access">
              <button v-for="qa in quickPaths" :key="qa.path" @click="editBrowseTo(qa.path)" class="qa-btn" :class="{ active: editBrowsePath === qa.path }">{{ qa.label }}</button>
            </div>
            <div class="browse-list browse-list-short" v-if="editBrowseData">
              <div v-if="editBrowseData.current !== editBrowseData.parent" class="browse-item" @click="editBrowseTo(editBrowseData.parent)">
                <FolderOpen :size="14" class="item-icon dir" /> <span>..</span>
              </div>
              <div v-for="v in editBrowseVideosSorted" :key="v.path" class="browse-item file-item" :class="{ selected: editForm.videoFilePath === v.path }" @click="selectEditVideoFile(v)">
                <Film :size="14" class="item-icon video" />
                <span class="file-name">{{ v.name }}</span>
                <span class="file-size">{{ formatSize(v.size) }}</span>
                <button class="btn-preview" @click.stop="previewFile = v.path" title="预览">▶</button>
                <CheckCircle v-if="editForm.videoFilePath === v.path" :size="14" class="check-icon" />
              </div>
              <div v-for="dir in editBrowseData.dirs" :key="dir.path" class="browse-item" @click="editBrowseTo(dir.path)">
                <Folder :size="14" class="item-icon dir" /> <span>{{ dir.name }}</span>
              </div>
              <div v-if="!editBrowseData.dirs.length && !editBrowseData.videos?.length" class="browse-empty">无视频文件</div>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>标题</label>
          <input v-model="editForm.title" class="input" />
        </div>
        <div class="form-group">
          <label>描述</label>
          <textarea v-model="editForm.description" class="input textarea" rows="20"></textarea>
        </div>
        <div class="form-group">
          <label>标签</label>
          <input v-model="editForm.hashtags" class="input" placeholder="标签（逗号分隔）" />
        </div>
      </template>

      <template #after-form>
        <div class="form-group">
          <label>封面图</label>
          <div class="edit-covers-grid">
            <div class="cover-card" :class="{ active: showEditBrowser && editCoverTarget === '43' }">
              <div class="cover-card-label">4:3</div>
              <div class="cover-card-preview" v-if="editForm.cover43Path" @click="previewEditCover(editForm.cover43Path, '43')">
                <img :src="editCoverUrl(editForm.cover43Path, '43')" />
              </div>
              <div class="cover-card-empty" v-else><ImageIcon :size="20" /><span>未设置</span></div>
              <div class="cover-card-actions">
                <button class="btn-outline btn-xs" @click="openEditBrowserFor('43')">选择</button>
                <button v-if="editForm.cover43Path" class="btn-outline btn-xs btn-danger" @click="editForm.cover43Path = ''">移除</button>
              </div>
            </div>
            <div class="cover-card" :class="{ active: showEditBrowser && editCoverTarget === '34' }">
              <div class="cover-card-label">3:4</div>
              <div class="cover-card-preview" v-if="editForm.cover34Path" @click="previewEditCover(editForm.cover34Path, '34')">
                <img :src="editCoverUrl(editForm.cover34Path, '34')" />
              </div>
              <div class="cover-card-empty" v-else><ImageIcon :size="20" /><span>未设置</span></div>
              <div class="cover-card-actions">
                <button class="btn-outline btn-xs" @click="openEditBrowserFor('34')">选择</button>
                <button v-if="editForm.cover34Path" class="btn-outline btn-xs btn-danger" @click="editForm.cover34Path = ''">移除</button>
              </div>
            </div>
          </div>
          <div v-if="showEditBrowser" class="edit-cover-browser">
            <div class="edit-browser-header">
              <span class="edit-browser-hint">正在选择 <strong>{{ editCoverTarget === '43' ? '4:3' : '3:4' }}</strong> 封面，点击图片即可选中</span>
              <button class="btn-outline btn-xs" @click="showEditBrowser = false">收起</button>
            </div>
            <div class="quick-access">
              <button v-for="qa in quickPaths" :key="qa.path" @click="editBrowseTo(qa.path)" class="qa-btn" :class="{ active: editBrowsePath === qa.path }">{{ qa.label }}</button>
            </div>
            <div class="browse-list browse-list-short" v-if="editBrowseData">
              <div v-if="editBrowseData.current !== editBrowseData.parent" class="browse-item" @click="editBrowseTo(editBrowseData.parent)">
                <FolderOpen :size="14" class="item-icon dir" /> <span>..</span>
              </div>
              <div v-for="img in editBrowseImagesSorted" :key="img.path" class="browse-item file-item" :class="{ selected: editForm.cover43Path === img.path || editForm.cover34Path === img.path }" @click="selectEditCoverForTarget(img)">
                <img :src="`${API_BASE}/api/fs/preview?path=${encodeURIComponent(img.path)}`" class="browse-img-thumb" />
                <span v-if="img.width && img.height" class="ratio-badge" :class="getAspectClass(img.width, img.height)">{{ getAspectLabel(img.width, img.height) }}</span>
                <span class="file-name">{{ img.name }}</span>
                <span class="file-size">{{ formatSize(img.size) }}</span>
                <button class="btn-preview" @click.stop="previewFile = img.path" title="预览">👁</button>
                <span v-if="editForm.cover43Path === img.path" class="cover-label">4:3</span>
                <span v-if="editForm.cover34Path === img.path" class="cover-label">3:4</span>
              </div>
              <div v-for="dir in editBrowseData.dirs" :key="dir.path" class="browse-item" @click="editBrowseTo(dir.path)">
                <Folder :size="14" class="item-icon dir" /> <span>{{ dir.name }}</span>
              </div>
              <div v-if="!editBrowseData.dirs.length && !editBrowseData.images?.length" class="browse-empty">无图片文件</div>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <span style="flex:1"></span>
        <button v-if="editingAsset?.videoId" class="btn-ai-generate" @click="aiGenerateContent('edit')" :disabled="isAIGenerating">
          <Loader2 v-if="isAIGenerating" :size="14" class="spin" />
          <Sparkles v-else :size="14" />
          {{ isAIGenerating ? 'AI 生成中...' : 'AI 生成' }}
        </button>
        <button @click="editingAsset = null" class="btn-outline">取消</button>
        <button @click="handleSaveEdit" class="btn-primary">保存</button>
      </template>
    </VideoFormDialog>

    <!-- Quick Publish Dialog -->
    <div v-if="publishingAsset" class="dialog-overlay" @click.self="publishingAsset = null">
      <div class="dialog glass-panel">
        <div class="dialog-header">
          <h3><Send :size="18" /> 发布视频</h3>
          <button @click="publishingAsset = null" class="btn-close"><X :size="16" /></button>
        </div>
        <div class="publish-preview">
          <div class="pv-row"><span class="pv-label">标题</span><span>{{ publishingAsset.title }}</span></div>
          <div class="pv-row"><span class="pv-label">描述</span><span>{{ publishingAsset.description || '—' }}</span></div>
          <div class="pv-row">
            <span class="pv-label">封面</span>
            <span v-if="!publishingAsset.cover43Path && !publishingAsset.cover34Path" class="warn">无封面（使用默认）</span>
            <div v-else class="pv-covers">
              <img v-if="publishingAsset.cover43Path" :src="`${API_BASE}/api/assets/${publishingAsset.id}/cover`" class="pv-cover-thumb" title="4:3 封面" @click="openCoverPreview(publishingAsset, '43')" />
              <img v-if="publishingAsset.cover34Path" :src="`${API_BASE}/api/assets/${publishingAsset.id}/cover?ratio=34`" class="pv-cover-thumb" title="3:4 封面" @click="openCoverPreview(publishingAsset, '34')" />
            </div>
          </div>
          <div class="pv-row">
            <span class="pv-label">视频</span>
            <video :src="`${API_BASE}/api/assets/${publishingAsset.id}/video#t=0.5`" muted autoplay playsinline loop preload="auto" controls class="pv-video-thumb"></video>
          </div>
        </div>
        <div class="mode-select platform-select">
          <span class="select-label">发布平台</span>
          <label v-for="p in platformOptions" :key="p.value" class="radio-opt">
            <input type="radio" v-model="pubPlatform" :value="p.value" />
            <span>{{ p.label }}</span>
          </label>
        </div>
        <div class="mode-select publish-mode">
          <span class="select-label">发布方式</span>
          <label class="radio-opt">
            <input type="radio" v-model="pubMode" value="draft" />
            <span>保存为草稿</span>
          </label>
          <label class="radio-opt">
            <input type="radio" v-model="pubMode" value="publish" />
            <span>直接发表</span>
          </label>
        </div>
        <div class="dialog-footer">
          <button @click="publishingAsset = null" class="btn-outline">取消</button>
          <button @click="confirmPublish" class="btn-primary">确认发布</button>
        </div>
        <div v-if="publishStatus" class="pub-status" :class="publishStatus.type">
          {{ publishStatus.message }}
        </div>
      </div>
    </div>

    <!-- Video Preview Modal -->
    <div v-if="previewAsset" class="dialog-overlay preview-overlay" @click.self="previewAsset = null">
      <div class="preview-modal">
        <div class="preview-header">
          <span class="preview-title">{{ previewAsset.title }}</span>
          <button @click="previewAsset = null" class="btn-close"><X :size="18" /></button>
        </div>
        <div class="preview-body">
          <video
            :src="`${API_BASE}/api/assets/${previewAsset.id}/video`"
            controls
            autoplay
            class="preview-video"
          ></video>
        </div>
      </div>
    </div>

    <!-- Cover Preview Modal (supports switching between 4:3 and 3:4) -->
    <div v-if="previewCoverAsset" class="dialog-overlay preview-overlay" @click.self="previewCoverAsset = null">
      <div class="preview-modal cover-modal">
        <div class="preview-header">
          <span class="preview-title">{{ previewCoverAsset.title }} — {{ previewCoverRatio === '43' ? '4:3' : '3:4' }} 封面</span>
          <button @click="previewCoverAsset = null" class="btn-close"><X :size="18" /></button>
        </div>
        <div class="preview-body cover-body">
          <button
            v-if="previewCoverAsset.cover43Path && previewCoverAsset.cover34Path"
            class="cover-nav cover-nav-left"
            @click="previewCoverRatio = previewCoverRatio === '43' ? '34' : '43'"
          >‹</button>
          <Transition name="cover-fade" mode="out-in">
            <img
              :key="previewCoverRatio"
              :src="`${API_BASE}/api/assets/${previewCoverAsset.id}/cover?ratio=${previewCoverRatio}`"
              class="preview-cover"
              alt="封面预览"
            />
          </Transition>
          <button
            v-if="previewCoverAsset.cover43Path && previewCoverAsset.cover34Path"
            class="cover-nav cover-nav-right"
            @click="previewCoverRatio = previewCoverRatio === '43' ? '34' : '43'"
          >›</button>
        </div>
        <div class="cover-indicator" v-if="previewCoverAsset.cover43Path && previewCoverAsset.cover34Path">
          <span :class="{ active: previewCoverRatio === '43' }">4:3</span>
          <span :class="{ active: previewCoverRatio === '34' }">3:4</span>
        </div>
      </div>
    </div>
    <!-- File Preview Modal (for import browser) -->
    <div v-if="previewFile" class="dialog-overlay preview-overlay" @click.self="previewFile = null">
      <div class="preview-modal">
        <div class="preview-header">
          <span class="preview-title">{{ getFileName(previewFile) }}</span>
          <button @click="previewFile = null" class="btn-close"><X :size="18" /></button>
        </div>
        <div class="preview-body" :class="{ 'cover-body': !isVideoFile(previewFile) }">
          <video
            v-if="isVideoFile(previewFile)"
            :src="getPreviewUrl(previewFile)"
            controls
            autoplay
            class="preview-video"
          ></video>
          <img
            v-else
            :src="getPreviewUrl(previewFile)"
            class="preview-cover"
            alt="预览"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  LayoutDashboard, FolderOpen, Send, Plus, Video, Play,
  Tag, HardDrive, ImageIcon, Pencil, Trash2, Package, X,
  Folder, Film, CheckCircle, Sparkles, Loader2, FileText, Eye,
} from 'lucide-vue-next';
import VideoFormDialog from '../../components/admin/VideoFormDialog.vue';
import {
  fetchAssets, deleteAsset, updateAsset,
  createPublishTask, runPublishTask, browseDirectory, importAsset,
  type PublishAsset, type BrowseResult, type FileInfo,
} from '../../services/adminApi';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const assets = ref<PublishAsset[]>([]);
const total = ref(0);
const filterStatus = ref<string | undefined>(undefined);
const searchQuery = ref('');
const showImportDialog = ref(false);
const editingAsset = ref<PublishAsset | null>(null);
const publishingAsset = ref<PublishAsset | null>(null);
const previewAsset = ref<PublishAsset | null>(null);
const previewCoverAsset = ref<PublishAsset | null>(null);
const previewCoverRatio = ref<'43' | '34'>('43');

function openCoverPreview(asset: PublishAsset, ratio: '43' | '34') {
  previewCoverAsset.value = asset;
  previewCoverRatio.value = ratio;
}
const pubMode = ref<'draft' | 'publish'>('draft');
const pubPlatform = ref('wxvideo');
const platformOptions = [
  { value: 'wxvideo', label: '微信视频号' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'douyin', label: '抖音' },
  { value: 'bilibili', label: 'B站' },
];
const publishStatus = ref<{ type: string; message: string } | null>(null);
const importing = ref(false);

// Import file browser state
const importStep = ref<'browse' | 'meta'>('browse');
const importBrowsePath = ref('');
const importBrowseData = ref<BrowseResult | null>(null);
const importBrowseTarget = ref<'video' | '43' | '34'>('video');
const showImportBrowser = ref(false);
const homeDir = ref('');
const previewFile = ref<string | null>(null);

const quickPaths = computed(() => {
  if (!homeDir.value) return [];
  return [
    { label: '下载', path: `${homeDir.value}/Downloads` },
    { label: '文档', path: `${homeDir.value}/Documents` },
    { label: '桌面', path: `${homeDir.value}/Desktop` },
    { label: '主目录', path: homeDir.value },
  ];
});

const editForm = ref({ title: '', description: '', hashtags: '', cover43Path: '', cover34Path: '', videoFilePath: '' });
const editBrowsePath = ref('');
const editBrowseData = ref<BrowseResult | null>(null);
const showEditBrowser = ref(false);
const editCoverTarget = ref<'43' | '34' | 'video'>('43');
const importForm = ref({ title: '', videoFilePath: '', cover43FilePath: '', cover34FilePath: '', description: '', hashtags: '' });

// Analyzed videos for association
interface AnalyzedVideo {
  videoId: string;
  title?: string;
  channelsTitle?: string;
  videoDescription?: string;
  videoHashtags?: string;
  redbookTitle?: string;
  redbookDescription?: string;
  redbookHashtags?: string;
}
const analyzedVideos = ref<AnalyzedVideo[]>([]);
const selectedVideoId = ref('');
const videoSearchQuery = ref('');
const videoDropdownOpen = ref(false);

const filteredVideos = computed(() => {
  const q = videoSearchQuery.value.toLowerCase().trim();
  if (!q) return analyzedVideos.value;
  return analyzedVideos.value.filter(v =>
    (v.title || v.videoId).toLowerCase().includes(q)
  );
});

function selectVideo(videoId: string) {
  selectedVideoId.value = videoId;
  const video = analyzedVideos.value.find(v => v.videoId === videoId);
  if (video) videoSearchQuery.value = video.title || video.videoId;
  videoDropdownOpen.value = false;
  fillFromVideo();
}

function clearVideoSelection() {
  selectedVideoId.value = '';
  videoSearchQuery.value = '';
  videoDropdownOpen.value = false;
  // Don't clear form fields - user may have edited them
}

const statusLabels: Record<string, string> = {
  draft: '草稿', ready: '待发布', publishing: '发布中',
  published: '已发布', draft_saved: '已保存', failed: '失败',
};

const statusOptions = computed(() => [
  { value: undefined, label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'ready', label: '待发布' },
  { value: 'published', label: '已发布' },
]);

const importPathSegments = computed(() => {
  if (!importBrowseData.value) return [];
  const parts = importBrowseData.value.current.split('/').filter(Boolean);
  return parts.map((name, i) => ({
    name: i === 0 ? '/' + name : name,
    path: '/' + parts.slice(0, i + 1).join('/'),
  }));
});

async function loadAssets() {
  const res = await fetchAssets({ status: filterStatus.value, search: searchQuery.value || undefined });
  assets.value = res.assets;
  total.value = res.total;
}

onMounted(loadAssets);
watch(filterStatus, loadAssets);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(loadAssets, 300);
}

// Import dialog: open file browser
watch(showImportDialog, async (v) => {
  if (v) {
    importStep.value = 'browse';
    importForm.value = { title: '', videoFilePath: '', cover43FilePath: '', cover34FilePath: '', description: '', hashtags: '' };
    selectedVideoId.value = '';
    showImportBrowser.value = false;
    if (!homeDir.value) {
      await importBrowseTo('');
    }
    // Default to Downloads
    if (homeDir.value) {
      await importBrowseTo(`${homeDir.value}/Downloads`);
    }
    if (!analyzedVideos.value.length) await loadAnalyzedVideos();
  }
});

async function loadAnalyzedVideos() {
  try {
    const res = await fetch(`${API_BASE}/api/videos/all`);
    const data = await res.json();
    analyzedVideos.value = (data.videos || []).map((v: any) => ({
      videoId: v.videoId,
      title: v.title,
      channelsTitle: v.channelsTitle,
      videoDescription: v.videoDescription,
      videoHashtags: v.videoHashtags,
      redbookTitle: v.redbookTitle,
      redbookDescription: v.redbookDescription,
      redbookHashtags: v.redbookHashtags,
    }));
  } catch { /* ignore */ }
}

function fillFromVideo() {
  const video = analyzedVideos.value.find(v => v.videoId === selectedVideoId.value);
  if (!video) return;
  // Fill title: prefer channelsTitle (视频号 compliant) > redbookTitle > original title
  if (video.channelsTitle) importForm.value.title = video.channelsTitle;
  else if (video.redbookTitle) importForm.value.title = video.redbookTitle;
  else if (video.title) importForm.value.title = video.title;
  // Fill description
  if (video.redbookDescription) importForm.value.description = video.redbookDescription;
  else if (video.videoDescription) importForm.value.description = video.videoDescription;
  // Fill hashtags
  if (video.redbookHashtags) importForm.value.hashtags = video.redbookHashtags;
  else if (video.videoHashtags) importForm.value.hashtags = video.videoHashtags;
}

const isAIGenerating = ref(false);

async function aiGenerateContent(target: 'import' | 'edit') {
  const vid = target === 'import' ? selectedVideoId.value : editingAsset.value?.videoId;
  if (!vid || isAIGenerating.value) return;
  isAIGenerating.value = true;
  try {
    // Regenerate both channels and redbook in parallel
    const [channelsRes, redbookRes] = await Promise.all([
      fetch(`${API_BASE}/api/videos/${vid}/regenerate-channels`, { method: 'POST' }).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/videos/${vid}/regenerate-redbook`, { method: 'POST' }).then(r => r.json()).catch(() => null),
    ]);

    const rb = redbookRes?.data;
    const ch = channelsRes?.data;
    const form = target === 'import' ? importForm.value : editForm.value;

    // Title: prefer channels title (视频号 compliant, max 16 chars)
    form.title = ch?.videoTitle || rb?.redbookTitle || form.title;
    form.description = rb?.redbookDescription || ch?.videoDescription || form.description;
    form.hashtags = rb?.redbookHashtags || ch?.videoHashtags || form.hashtags;
  } catch (e) {
    alert('AI 生成失败: ' + (e as Error).message);
  } finally {
    isAIGenerating.value = false;
  }
}

// Apply AI-generated content to edit form
function applyAiContent(content: string) {
  if (content.length <= 30 && !content.includes('\n')) {
    editForm.value.title = content.replace(/^["""『』【】]|["""『』【】]$/g, '');
  } else if (content.includes('#')) {
    editForm.value.hashtags = content.replace(/#/g, '').split(/[,，\s]+/).filter(Boolean).join(',');
  } else {
    editForm.value.description = content;
  }
}

// Apply AI-generated content to import form
function applyImportAiContent(content: string) {
  if (content.length <= 30 && !content.includes('\n')) {
    importForm.value.title = content.replace(/^["""『』【】]|["""『』【】]$/g, '');
  } else if (content.includes('#')) {
    importForm.value.hashtags = content.replace(/#/g, '').split(/[,，\s]+/).filter(Boolean).join(',');
  } else {
    importForm.value.description = content;
  }
}

async function importBrowseTo(dir: string) {
  try {
    importBrowseData.value = await browseDirectory(dir || undefined);
    importBrowsePath.value = importBrowseData.value.current;
    previewFile.value = null;
    // Capture home dir from initial browse
    if (!homeDir.value) {
      if (!dir) {
        homeDir.value = importBrowseData.value.current;
      } else {
        // Infer home from Downloads/Documents/Desktop path
        const m = importBrowseData.value.current.match(/^(.+)\/(Downloads|Documents|Desktop)/);
        if (m) homeDir.value = m[1];
      }
    }
  } catch { /* ignore */ }
}

function selectImportVideo(file: FileInfo) {
  importForm.value.videoFilePath = file.path;
  // Auto-fill title from filename (without extension)
  if (!importForm.value.title) {
    importForm.value.title = file.name.replace(/\.[^.]+$/, '');
  }
}

function selectImportCover(file: FileInfo) {
  // Left click assigns to 4:3 slot (or to 3:4 if 4:3 is already filled)
  if (!importForm.value.cover43FilePath || importForm.value.cover43FilePath === file.path) {
    importForm.value.cover43FilePath = file.path;
  } else if (!importForm.value.cover34FilePath || importForm.value.cover34FilePath === file.path) {
    importForm.value.cover34FilePath = file.path;
  } else {
    // Both filled, replace 4:3
    importForm.value.cover43FilePath = file.path;
  }
}

function selectImportCover34(file: FileInfo) {
  // Right click explicitly assigns to 3:4 slot
  importForm.value.cover34FilePath = file.path;
}

function openImportBrowserFor(target: 'video' | '43' | '34') {
  importBrowseTarget.value = target;
  showImportBrowser.value = true;
  if (!importBrowseData.value) {
    const downloadsPath = homeDir.value ? `${homeDir.value}/Downloads` : '';
    importBrowseTo(downloadsPath);
  }
}

function selectImportForTarget(file: FileInfo) {
  if (importBrowseTarget.value === 'video') {
    selectImportVideo(file);
  } else if (importBrowseTarget.value === '43') {
    importForm.value.cover43FilePath = file.path;
  } else {
    importForm.value.cover34FilePath = file.path;
  }
}

const importBrowseFilesSorted = computed(() => {
  if (!importBrowseData.value) return { videos: [] as FileInfo[], images: [] as FileInfo[] };
  const images = [...(importBrowseData.value.images || [])].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return { videos: importBrowseData.value.videos, images };
});

async function editBrowseTo(dir: string) {
  try {
    editBrowseData.value = await browseDirectory(dir || undefined);
    editBrowsePath.value = editBrowseData.value.current;
    if (!homeDir.value && !dir) {
      homeDir.value = editBrowseData.value.current;
    }
  } catch { /* ignore */ }
}

function selectEditCoverForTarget(file: FileInfo) {
  if (editCoverTarget.value === '43') {
    editForm.value.cover43Path = file.path;
  } else {
    editForm.value.cover34Path = file.path;
  }
}

function openEditBrowserFor(target: '43' | '34' | 'video') {
  editCoverTarget.value = target;
  showEditBrowser.value = true;
  if (!editBrowseData.value) editBrowseTo('');
}

const editBrowseImagesSorted = computed(() => {
  if (!editBrowseData.value?.images) return [];
  return [...editBrowseData.value.images].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
});

const editBrowseVideosSorted = computed(() => {
  if (!editBrowseData.value?.videos) return [];
  return [...editBrowseData.value.videos].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
});

function selectEditVideoFile(file: { path: string }) {
  editForm.value.videoFilePath = file.path;
  showEditBrowser.value = false;
}

function editCoverUrl(coverPath: string, ratio: string): string {
  if (coverPath.startsWith('/')) {
    // Absolute path = local file not yet imported
    return `${API_BASE}/api/fs/preview?path=${encodeURIComponent(coverPath)}`;
  }
  // Relative path = already in asset store
  if (editingAsset.value) {
    return `${API_BASE}/api/assets/${editingAsset.value.id}/cover?ratio=${ratio}`;
  }
  return '';
}

function previewEditCover(coverPath: string, ratio: string) {
  if (coverPath.startsWith('/')) {
    previewFile.value = coverPath;
  } else if (editingAsset.value) {
    // For managed covers, open the preview using the asset cover endpoint URL
    // Set previewFile to a special marker so the preview modal uses the right URL
    previewFile.value = `__asset_cover__${editingAsset.value.id}__${ratio}`;
  }
}

function getFileName(filePath: string) {
  return filePath.split('/').pop() || filePath;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
}

function isVideoFile(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext);
}

function getAspectLabel(w: number, h: number): string {
  const ratio = w / h;
  if (ratio >= 1.2 && ratio <= 1.5) return '4:3';
  if (ratio >= 0.65 && ratio <= 0.85) return '3:4';
  if (ratio >= 1.7) return '16:9';
  if (ratio >= 0.5 && ratio < 0.65) return '9:16';
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  return `${w}×${h}`;
}

function getAspectClass(w: number, h: number): string {
  const ratio = w / h;
  if (ratio >= 1.2 && ratio <= 1.5) return 'ratio-landscape';
  if (ratio >= 0.65 && ratio <= 0.85) return 'ratio-portrait';
  return '';
}

function getPreviewUrl(filePath: string) {
  if (filePath.startsWith('__asset_cover__')) {
    const parts = filePath.replace('__asset_cover__', '').split('__');
    const assetId = parts[0];
    const ratio = parts[1] || '43';
    return `${API_BASE}/api/assets/${assetId}/cover?ratio=${ratio}`;
  }
  return `${API_BASE}/api/fs/preview?path=${encodeURIComponent(filePath)}`;
}

async function handleImport() {
  if (importing.value) return;
  importing.value = true;
  try {
    await importAsset({
      ...importForm.value,
      videoId: selectedVideoId.value || undefined,
    });
    showImportDialog.value = false;
    importForm.value = { title: '', videoFilePath: '', cover43FilePath: '', cover34FilePath: '', description: '', hashtags: '' };
    selectedVideoId.value = '';
    await loadAssets();
  } catch (e) {
    alert('导入失败: ' + (e as Error).message);
  } finally {
    importing.value = false;
  }
}

async function handleDelete(id: string) {
  if (!confirm('确定删除该视频？关联的文件也会被删除。')) return;
  await deleteAsset(id);
  await loadAssets();
}

function editAsset(asset: PublishAsset) {
  editingAsset.value = asset;
  editForm.value = { title: asset.title, description: asset.description || '', hashtags: asset.hashtags || '', cover43Path: asset.cover43Path || '', cover34Path: asset.cover34Path || '', videoFilePath: asset.videoFilePath || '' };
  showEditBrowser.value = false;
  editBrowseData.value = null;
}

async function handleSaveEdit() {
  if (!editingAsset.value) return;
  try {
    const result = await updateAsset(editingAsset.value.id, editForm.value);
    if (!result || result.error) {
      alert('保存失败: ' + (result?.error || '未知错误'));
      return;
    }
    editingAsset.value = null;
    await loadAssets();
  } catch (e) {
    console.error('Save edit failed:', e);
    alert('保存失败: ' + (e as Error).message);
  }
}

function quickPublish(asset: PublishAsset) {
  publishingAsset.value = asset;
  pubMode.value = 'draft';
  publishStatus.value = null;
}

async function confirmPublish() {
  if (!publishingAsset.value) return;
  publishStatus.value = { type: 'info', message: '创建发布任务...' };
  try {
    const task = await createPublishTask({
      assetId: publishingAsset.value.id,
      platform: pubPlatform.value,
      publishMode: pubMode.value,
    });
    publishStatus.value = { type: 'info', message: '正在执行发布...' };
    await runPublishTask(task.id);
    publishStatus.value = { type: 'success', message: '发布任务已提交！请在浏览器确认结果' };
    await loadAssets();
  } catch (e) {
    publishStatus.value = { type: 'error', message: '失败: ' + (e as Error).message };
  }
}

function getExt(filepath: string) {
  return filepath.split('.').pop()?.toUpperCase() || 'MP4';
}
function shortenPath(p: string) {
  const parts = p.split('/');
  return parts.length > 3 ? `.../${parts.slice(-2).join('/')}` : p;
}
function truncate(s: string, n: number) {
  return s.length > n ? s.substring(0, n) + '...' : s;
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
function coverLabel(asset: PublishAsset) {
  const has43 = !!asset.cover43Path;
  const has34 = !!asset.cover34Path;
  if (has43 && has34) return '封面×2';
  if (has43) return '4:3';
  if (has34) return '3:4';
  return '无封面';
}
</script>

<style scoped>
.assets-view {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 1.5rem 2.5rem;
  animation: fadeIn 0.3s ease-out;
}

/* Nav */
.admin-nav {
  display: flex; gap: 0.25rem; margin-bottom: 1.5rem;
  padding-bottom: 1rem; border-bottom: 1px solid var(--border-color);
}
.admin-nav-item {
  padding: 0.5rem 1rem; border-radius: var(--radius-sm);
  color: var(--text-secondary); text-decoration: none;
  font-size: 0.85rem; transition: all var(--transition-fast);
  display: flex; align-items: center; gap: 0.4rem;
}
.admin-nav-item:hover { color: var(--text-primary); background: rgba(255,255,255,0.04); }
.admin-nav-item.active { color: var(--accent-color); background: rgba(99, 102, 241, 0.1); font-weight: 600; }

/* Header */
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.header-left { display: flex; align-items: center; gap: 0.75rem; }
.page-title { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); }
.count-badge {
  font-size: 0.75rem; padding: 2px 8px; border-radius: 10px;
  background: rgba(99, 102, 241, 0.15); color: #818cf8; font-weight: 600;
}
.header-actions { display: flex; gap: 0.75rem; align-items: center; }
.search-input {
  padding: 0.4rem 0.75rem;
  border: 1px solid #333;
  border-radius: 6px;
  background: #1a1a2e;
  color: #e2e8f0;
  font-size: 0.85rem;
  width: 180px;
  outline: none;
  transition: border-color 0.2s;
}
.search-input:focus { border-color: #6366f1; }
.search-input::placeholder { color: #666; }

/* Toolbar */
.toolbar { margin-bottom: 1.5rem; }
.filters { display: flex; gap: 0.4rem; }
.filter-btn {
  padding: 0.35rem 0.9rem; border-radius: 20px;
  border: 1px solid var(--border-color);
  background: transparent; color: var(--text-secondary);
  cursor: pointer; font-size: 0.8rem;
  transition: all var(--transition-fast);
}
.filter-btn:hover { border-color: var(--border-hover); color: var(--text-primary); }
.filter-btn.active { background: var(--accent-color); color: white; border-color: var(--accent-color); }

/* Horizontal Asset Cards */
.asset-list { display: flex; flex-direction: column; gap: 0.75rem; }
.asset-row {
  display: flex; align-items: center; gap: 1.25rem;
  padding: 1rem 1.5rem;
  transition: all var(--transition-normal);
}
.asset-row:hover { border-color: var(--border-hover); }

.asset-thumb {
  width: 64px; height: 80px; border-radius: 8px;
  background: rgba(99, 102, 241, 0.08);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex-shrink: 0; position: relative; overflow: hidden;
}
.thumb-img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
.thumb-icon { color: var(--accent-color); opacity: 0.7; }
.thumb-ext {
  font-size: 0.6rem; font-weight: 700; color: var(--text-secondary);
  margin-top: 2px; text-transform: uppercase;
}

.asset-info { flex: 1; min-width: 0; }
.info-top { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.4rem; }
.asset-title {
  font-size: 0.95rem; font-weight: 600; margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--text-primary);
}
.info-lines { display: flex; flex-direction: column; gap: 0.25rem; }
.info-line {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.78rem; color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.info-line span { overflow: hidden; text-overflow: ellipsis; }
.info-line.meta-path { font-family: monospace; opacity: 0.7; font-size: 0.72rem; }
.meta-date { font-size: 0.7rem; color: var(--text-secondary); opacity: 0.6; margin-top: 0.3rem; }
.info-meta {
  display: flex; gap: 1rem; align-items: center;
  font-size: 0.75rem; color: var(--text-secondary);
}
.info-meta span { display: flex; align-items: center; gap: 0.3rem; }
.meta-path { font-family: monospace; opacity: 0.7; }

.status-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 20px; flex-shrink: 0; }
.status-badge.draft { background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); }
.status-badge.ready { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
.status-badge.publishing { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
.status-badge.published, .status-badge.draft_saved { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status-badge.failed { background: rgba(239, 68, 68, 0.15); color: #f87171; }

.asset-covers { flex-shrink: 0; }
.cover-chip {
  display: flex; align-items: center; gap: 0.3rem;
  font-size: 0.7rem; padding: 3px 8px; border-radius: 4px;
  background: rgba(255,255,255,0.04); color: var(--text-secondary);
}
.cover-chip.ready { background: rgba(34, 197, 94, 0.1); color: #4ade80; }

/* Cover thumbnails in card */
.asset-cover-thumbs {
  display: flex; gap: 0.5rem; flex-shrink: 0; align-items: center;
}
.cover-thumb {
  height: 56px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--border-color); object-fit: cover;
  transition: all var(--transition-fast);
}
.cover-thumb:hover { border-color: var(--accent-color); transform: scale(1.05); }
.cover-thumb.cover-43 { width: 75px; }
.cover-thumb.cover-34 { width: 42px; }

/* Cover ratio tabs in preview modal */
.cover-ratio-tabs { display: flex; gap: 0.3rem; }
.cover-ratio-tabs button {
  padding: 0.2rem 0.6rem; border-radius: 4px; border: 1px solid var(--border-color);
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 0.75rem;
}
.cover-ratio-tabs button.active { background: var(--accent-color); color: #fff; border-color: var(--accent-color); }

/* Cover navigation arrows */
.cover-body { position: relative; }
.cover-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  background: rgba(0,0,0,0.5); color: #fff; border: none; cursor: pointer;
  width: 40px; height: 40px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.5rem; line-height: 1; z-index: 2; transition: background 0.2s;
}
.cover-nav:hover { background: rgba(0,0,0,0.8); }
.cover-nav-left { left: 0.75rem; }
.cover-nav-right { right: 0.75rem; }
.cover-indicator {
  display: flex; justify-content: center; gap: 0.75rem; padding: 0.5rem;
  font-size: 0.75rem; color: var(--text-secondary);
}
.cover-indicator span.active { color: var(--accent-color); font-weight: 600; }
.preview-cover { transition: opacity 0.3s ease, transform 0.3s ease; }
/* Cover switch transition */
.cover-fade-enter-active, .cover-fade-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.cover-fade-enter-from { opacity: 0; transform: scale(0.95); }
.cover-fade-leave-to { opacity: 0; transform: scale(0.95); }

.asset-actions { display: flex; gap: 0.4rem; flex-shrink: 0; align-items: center; }
.btn-action {
  padding: 0.35rem 0.8rem; font-size: 0.8rem; border-radius: 6px;
  border: 1px solid var(--border-color); background: transparent;
  color: var(--text-primary); cursor: pointer;
  display: flex; align-items: center; gap: 0.3rem;
  transition: all var(--transition-fast);
}
.btn-publish { border-color: rgba(99, 102, 241, 0.4); color: var(--accent-color); }
.btn-publish:hover { background: rgba(99, 102, 241, 0.1); }
.btn-publish:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-icon-sm {
  width: 30px; height: 30px; border-radius: 6px;
  border: 1px solid transparent; background: transparent;
  color: var(--text-secondary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--transition-fast);
}
.btn-icon-sm:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }
.btn-danger:hover { background: rgba(239, 68, 68, 0.1); color: #f87171; }

/* Empty State */
.empty-state { text-align: center; padding: 5rem 2rem; }
.empty-icon { color: var(--text-secondary); opacity: 0.4; margin-bottom: 1rem; }
.empty-title { color: var(--text-primary); font-size: 1.1rem; font-weight: 600; margin: 0 0 0.5rem; }
.empty-hint { color: var(--text-secondary); font-size: 0.85rem; margin: 0; }

/* Buttons */
.btn-primary {
  padding: 0.45rem 1.1rem; border-radius: var(--radius-sm);
  background: var(--accent-color); color: white; border: none;
  font-weight: 500; cursor: pointer; font-size: 0.85rem;
  display: flex; align-items: center; gap: 0.4rem;
  transition: all var(--transition-fast);
}
.btn-primary:hover { box-shadow: var(--shadow-glow); transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.btn-outline {
  padding: 0.45rem 1.1rem; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-primary);
  border: 1px solid var(--border-color); cursor: pointer;
  font-size: 0.85rem; display: flex; align-items: center; gap: 0.4rem;
  transition: all var(--transition-fast);
}
.btn-outline:hover { border-color: var(--border-hover); }
.btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }

/* Dialogs */
.dialog-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center; z-index: 100;
  backdrop-filter: blur(4px);
}
.dialog { padding: 1.75rem; width: 560px; max-width: 90vw; max-height: 85vh; overflow-y: auto; overflow-x: hidden; min-width: 0; display: flex; flex-direction: column; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.dialog-header h3 { font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; margin: 0; }
.dialog-desc { color: var(--text-secondary); font-size: 0.8rem; margin: 0 0 1.25rem; }
.dialog-footer { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: auto; padding-top: 1rem; }
.btn-close {
  width: 28px; height: 28px; border-radius: 6px;
  border: none; background: transparent; color: var(--text-secondary);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.btn-close:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }

/* Import Steps */
.import-steps {
  display: flex; align-items: center; gap: 0.75rem;
  margin-bottom: 1.25rem; padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}
.step {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.8rem; color: var(--text-secondary);
}
.step.active { color: var(--accent-color); font-weight: 600; }
.step.done { color: #4ade80; }
.step-num {
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.7rem; font-weight: 700;
  background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);
}
.step.active .step-num { background: var(--accent-color); color: white; border-color: var(--accent-color); }
.step.done .step-num { background: rgba(34, 197, 94, 0.2); color: #4ade80; border-color: #4ade80; }
.step-arrow { color: var(--text-secondary); font-size: 0.8rem; }

/* Selected files display */
.selected-files {
  display: flex; gap: 0.75rem; margin-bottom: 1rem;
  overflow-x: auto; min-width: 0;
}

/* Quick access shortcuts */
.quick-access {
  display: flex; align-items: center; gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.qa-label { font-size: 0.75rem; color: var(--text-secondary); }
.qa-btn {
  padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.75rem;
  border: 1px solid var(--border-color); background: transparent;
  color: var(--text-secondary); cursor: pointer;
  transition: all var(--transition-fast);
}
.qa-btn:hover { border-color: var(--accent-color); color: var(--accent-color); }
.qa-btn.active { background: rgba(99, 102, 241, 0.1); border-color: var(--accent-color); color: var(--accent-color); }
.selected-slot {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.5rem;
  padding: 0.6rem 0.9rem; border-radius: var(--radius-sm);
  border: 1px solid var(--border-color); background: var(--bg-secondary);
  font-size: 0.8rem; overflow: hidden;
}
.slot-label { color: var(--text-secondary); font-size: 0.75rem; white-space: nowrap; }
.slot-value { color: #4ade80; font-family: monospace; font-size: 0.75rem; display: flex; align-items: center; gap: 0.3rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.slot-placeholder { color: var(--text-secondary); opacity: 0.5; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.selected-slot.clickable { cursor: pointer; }
.selected-slot.clickable:hover { border-color: var(--accent-color); background: rgba(99, 102, 241, 0.05); }
.slot-clear {
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; padding: 0; display: flex;
}
.slot-clear:hover { color: #f87171; }

/* File browser tall */
.browse-list-tall { max-height: 320px; }
.browse-list-short { max-height: 180px; }
.file-item { position: relative; }
.file-item.selected { background: rgba(99, 102, 241, 0.1); }
.file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { color: var(--text-secondary); font-size: 0.7rem; font-family: monospace; }
.item-icon.dir { color: #fbbf24; }
.dir-media-dot { color: #4ade80; font-size: 0.6rem; margin-left: auto; }
.item-icon.video { color: var(--accent-color); }
.item-icon.image { color: #4ade80; }
.check-icon { color: var(--accent-color); flex-shrink: 0; }
.cover-label {
  font-size: 0.65rem; font-weight: 700; padding: 1px 5px;
  border-radius: 3px; background: rgba(99, 102, 241, 0.15);
  color: var(--accent-color);
}

/* Preview button in file list */
.btn-preview {
  background: none; border: none; cursor: pointer;
  font-size: 0.7rem; padding: 2px 4px; border-radius: 3px;
  opacity: 0; transition: opacity var(--transition-fast);
  color: var(--text-secondary);
}
.browse-item:hover .btn-preview { opacity: 1; }
.btn-preview:hover { background: rgba(99, 102, 241, 0.1); color: var(--accent-color); }

/* Import meta summary */
.selected-summary {
  display: flex; gap: 1rem; margin-bottom: 1.25rem;
  padding: 0.75rem 1rem; border-radius: var(--radius-sm);
  background: rgba(99, 102, 241, 0.06); border: 1px solid rgba(99, 102, 241, 0.15);
}
.summary-item {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.8rem; color: var(--text-primary); font-family: monospace;
}
.summary-item.clickable { cursor: pointer; padding: 0.2rem 0.4rem; border-radius: 4px; }
.summary-item.clickable:hover { background: rgba(99, 102, 241, 0.1); color: var(--accent-color); }

.form-group { margin-bottom: 1rem; min-width: 0; }
.form-group label { display: block; font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.35rem; font-weight: 500; }
.video-file-row { display: flex; align-items: center; gap: 8px; }
.video-file-info { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-primary); min-width: 0; }
.video-file-info .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.text-muted { color: var(--text-secondary); font-size: 0.8rem; }
.input {
  width: 100%; padding: 0.55rem 0.75rem;
  border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--bg-secondary); color: var(--text-primary);
  font-size: 0.85rem; box-sizing: border-box;
}
.input:focus { outline: none; border-color: var(--accent-color); }
.textarea { resize: vertical; font-family: inherit; }

/* Folder Browser */
.path-input-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
.path-input-row .input { flex: 1; }
.browse-breadcrumb { display: flex; flex-wrap: wrap; margin-bottom: 0.5rem; font-size: 0.75rem; font-family: monospace; }
.crumb { color: var(--accent-color); cursor: pointer; }
.crumb:hover { text-decoration: underline; }
.crumb-sep { color: var(--text-secondary); margin: 0 2px; }

.browse-list {
  max-height: 240px; overflow-y: auto;
  border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--bg-secondary); margin-bottom: 0.75rem;
}
.browse-item {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.45rem 0.75rem; cursor: pointer; font-size: 0.8rem;
  transition: background var(--transition-fast);
  border-bottom: 1px solid rgba(255,255,255,0.02);
  min-width: 0; overflow: hidden;
}
.browse-item:hover { background: rgba(99, 102, 241, 0.06); }
.browse-empty { padding: 1.5rem; text-align: center; color: var(--text-secondary); font-size: 0.8rem; }

.browse-info { margin-bottom: 0.5rem; font-size: 0.8rem; display: flex; align-items: center; gap: 0.4rem; }
.video-found { color: #4ade80; display: flex; align-items: center; gap: 0.3rem; }
.no-video { color: var(--text-secondary); }
.scan-result { margin-top: 0.75rem; color: #4ade80; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem; }

/* Publish Preview */
.publish-preview {
  background: rgba(255,255,255,0.02); border-radius: var(--radius-sm);
  padding: 1rem; margin: 0.75rem 0;
}
.pv-row { display: flex; gap: 0.75rem; margin-bottom: 0.5rem; font-size: 0.85rem; align-items: baseline; }
.pv-row:last-child { margin-bottom: 0; }
.pv-label { color: var(--text-secondary); min-width: 3rem; font-size: 0.75rem; }
.mono { font-family: monospace; font-size: 0.8rem; opacity: 0.7; }
.warn { color: #fbbf24; }

.mode-select { display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap; }
.mode-select .select-label { font-size: 0.8rem; color: var(--text-secondary); min-width: 4em; }
.platform-select { margin: 1rem 0 0.5rem; }
.publish-mode { margin: 0.5rem 0 1rem; }
.radio-opt {
  display: flex; align-items: center; gap: 0.35rem;
  font-size: 0.85rem; color: var(--text-primary); cursor: pointer;
}
.radio-opt input { accent-color: var(--accent-color); }

.pub-status { margin-top: 1rem; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.8rem; }
.pub-status.info { background: rgba(99, 102, 241, 0.1); color: #818cf8; }
.pub-status.success { background: rgba(34, 197, 94, 0.1); color: #4ade80; }
.pub-status.error { background: rgba(239, 68, 68, 0.1); color: #f87171; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Thumbnail play button */
.asset-thumb { cursor: pointer; position: relative; }
.thumb-play {
  position: absolute; bottom: 3px; right: 3px;
  width: 18px; height: 18px; border-radius: 50%;
  background: rgba(99, 102, 241, 0.8); color: white;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity var(--transition-fast);
}
.asset-thumb:hover .thumb-play { opacity: 1; }

.cover-chip.clickable { cursor: pointer; }
.cover-chip.clickable:hover { background: rgba(34, 197, 94, 0.15); }

/* Video Preview Modal */
.preview-overlay { z-index: 200; }
.preview-modal {
  width: 90vw; max-width: 960px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 25px 50px rgba(0,0,0,0.5);
}
.preview-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--border-color);
}
.preview-title { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
.preview-body { padding: 0; background: #000; }
.preview-video {
  width: 100%; max-height: 70vh; display: block;
  outline: none;
}

/* Cover Preview */
.cover-modal { max-width: 640px; }
.cover-body { display: flex; align-items: center; justify-content: center; padding: 1rem; background: var(--bg-secondary); }
.preview-cover { max-width: 100%; max-height: 60vh; border-radius: 4px; }

/* Searchable select dropdown */
.searchable-select { position: relative; }

/* AI generate bar */
.ai-generate-bar { margin-bottom: 0.75rem; }
.btn-ai-generate {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem 0.8rem; border-radius: var(--radius-sm);
  border: 1px solid rgba(99, 102, 241, 0.3); background: rgba(99, 102, 241, 0.08);
  color: var(--accent-color); cursor: pointer; font-size: 0.8rem;
  transition: all var(--transition-fast);
}
.btn-ai-generate:hover:not(:disabled) { background: rgba(99, 102, 241, 0.15); border-color: var(--accent-color); }
.btn-ai-generate:disabled { opacity: 0.6; cursor: not-allowed; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.searchable-select .clear-select {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; font-size: 14px; color: #999;
  line-height: 1; padding: 2px 4px;
}
.searchable-select .clear-select:hover { color: #333; }
.dropdown-list {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 100;
  max-height: 200px; overflow-y: auto;
  background: #1e1e1e; border: 1px solid #444;
  border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); margin-top: 2px;
}
.dropdown-item {
  padding: 8px 12px; cursor: pointer; font-size: 13px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: #ddd;
}
.dropdown-item:hover { background: rgba(99, 102, 241, 0.1); }
.dropdown-item.selected { background: rgba(99, 102, 241, 0.15); font-weight: 500; color: var(--accent-color); }
.dropdown-item.disabled { color: #999; cursor: default; }

/* Edit cover section */
.edit-covers-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.5rem;
}
.cover-card {
  border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  padding: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
  transition: border-color 0.2s;
}
.cover-card.active { border-color: var(--accent-color); box-shadow: 0 0 8px rgba(99, 102, 241, 0.2); }
.cover-card-label { font-size: 0.7rem; font-weight: 600; color: var(--text-secondary); }
.cover-card-preview { cursor: pointer; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; }
.cover-card-preview img { width: 100%; max-height: 80px; object-fit: contain; border-radius: 3px; }
.cover-card-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.2rem; color: var(--text-secondary); padding: 0.5rem 0; font-size: 0.75rem; flex: 1; }
.cover-card-actions { display: flex; gap: 0.4rem; margin-top: auto; }
.import-video-thumb { width: 100%; max-height: 80px; object-fit: contain; border-radius: 3px; }
.btn-xs { padding: 2px 8px; font-size: 0.7rem; }
.btn-danger { color: #f87171; border-color: #f87171; }
.btn-danger:hover { background: rgba(248, 113, 113, 0.1); }
.edit-cover-browser { margin-top: 0.5rem; min-width: 0; overflow: hidden; }
.edit-browser-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
.edit-browser-hint { font-size: 0.75rem; color: var(--text-secondary); }
.ratio-badge {
  font-size: 0.6rem; padding: 1px 4px; border-radius: 3px; font-weight: 600; flex-shrink: 0;
  background: rgba(100, 116, 139, 0.2); color: #94a3b8;
}
.ratio-badge.ratio-landscape { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.ratio-badge.ratio-portrait { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.import-selection-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem; align-items: stretch;
}
.import-card-wide { }
.import-card-filename { font-size: 0.7rem; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.video-icon-placeholder { color: var(--accent-color); }
.browse-img-thumb {
  width: 28px; height: 28px; object-fit: cover; border-radius: 3px; flex-shrink: 0;
}
.pv-covers {
  display: flex; align-items: center; gap: 0.5rem;
}
.pv-cover-thumb {
  width: 80px; height: 60px; object-fit: cover; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--border-color);
}
.pv-video-thumb {
  width: 300px; max-height: 160px; object-fit: contain; border-radius: 4px;
  border: 1px solid var(--border-color); background: #000;
}
.pv-cover-thumb:hover { border-color: var(--accent-color); }
</style>
