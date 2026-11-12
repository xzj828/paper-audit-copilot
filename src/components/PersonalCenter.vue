<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { Camera, Pencil, ChevronRight, Menu, RefreshCw, LogOut } from 'lucide-vue-next';
import type { EChartsOption } from 'echarts';
import PersonalChart from './PersonalChart.vue';
import Modal from './Modal.vue';
import SelectContent from './SelectContent';
import { currentAccount, type Account } from '../account';
import { api, json } from '../api';
import { dateKey, daysBefore, type Overview } from '../personal-center';
import { vCatalogWave } from '../catalog-wave';
import { vHeatmapMotion } from '../heatmap-motion';
import '../personal-center.css';
const emit = defineEmits<{ menu: []; account: [] }>();
const data = ref<Overview>(),
  loading = ref(true),
  error = ref('');
const period = ref(30),
  mode = ref<'day' | 'week' | 'total'>('day');
const editing = ref(false),
  saving = ref(false),
  processing = ref(false),
  editError = ref(''),
  message = ref('');
const draftName = ref(''),
  draftAvatar = ref(''),
  fileInput = ref<HTMLInputElement>();
const name = computed(
  () => currentAccount.value?.displayName || currentAccount.value?.username || '我的空间',
);
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const theme = ref(document.documentElement.dataset.theme);
const themeObserver = new MutationObserver(() => {
  theme.value = document.documentElement.dataset.theme;
});
function themeToken(name: string) {
  // Track the theme attribute, then use the shared design-system value.
  void theme.value;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const ink = computed(() => themeToken('--text'));
const muted = computed(() => themeToken('--muted'));
const border = computed(() => themeToken('--border'));
const paper = computed(() => themeToken('--paper'));
const seriesDays = computed(() =>
  daysBefore(data.value?.today || today, period.value).map(
    (date) =>
      data.value?.daily.find((item) => item.date === date) || { date, discovered: 0, resolved: 0 },
  ),
);
const chartBase = computed(() => ({
  textStyle: {
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim(),
    color: ink.value,
    fontSize: 12,
  },
  animationDuration: 1600,
  animationEasing: 'cubicOut' as const,
  animationDurationUpdate: 600,
  tooltip: {
    confine: true,
    backgroundColor: paper.value,
    borderColor: border.value,
    textStyle: { color: ink.value, fontSize: 13 },
    extraCssText: 'box-shadow:0 6px 24px #0002;border-radius:8px;',
  },
}));
const lineOption = computed<EChartsOption>(() => ({
  ...chartBase.value,
  tooltip: {
    ...chartBase.value.tooltip,
    trigger: 'axis',
    // Keep inspection immediate; only the chart entrance should animate.
    transitionDuration: 0,
    showDelay: 0,
    hideDelay: 0,
    axisPointer: {
      type: 'line',
      snap: true,
      animation: false,
      lineStyle: { color: muted.value, width: 1, type: 'dashed' },
      label: { show: true, backgroundColor: '#303844' },
    },
    valueFormatter: (v) => `${v} 个`,
  },
  grid: { left: 42, right: 14, top: 26, bottom: 32 },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: seriesDays.value.map((d) => d.date),
    axisTick: { show: false },
    axisLine: { lineStyle: { color: border.value } },
    axisLabel: {
      color: muted.value,
      hideOverlap: true,
      formatter: (v: string) => v.slice(5).replace('-', '/'),
    },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    min: 0,
    name: '（个）',
    nameTextStyle: { color: muted.value, padding: [0, 0, 0, 10] },
    axisLabel: { color: muted.value },
    splitLine: { lineStyle: { color: border.value } },
  },
  series: ['discovered', 'resolved'].map((key, i) => ({
    name: i ? '已解决问题' : '新发现问题',
    type: 'line' as const,
    data: seriesDays.value.map((d) => d[key as 'discovered' | 'resolved']),
    symbol: 'emptyCircle',
    symbolSize: 6,
    showSymbol: period.value <= 30,
    lineStyle: { width: 2, color: i ? '#12b9ba' : '#0866f5' },
    itemStyle: { color: i ? '#12b9ba' : '#0866f5' },
    areaStyle: { color: i ? '#12b9ba' : '#0866f5', opacity: 0.05 },
    animationDuration: 1800,
    animationDelay: 250,
    animationEasing: 'linear',
    emphasis: { focus: 'none', scale: 1.6 },
    blur: { lineStyle: { opacity: 1 }, areaStyle: { opacity: 0.05 }, itemStyle: { opacity: 1 } },
  })),
}));
const calendar = computed(() => {
  const end = new Date(`${data.value?.today || today}T00:00:00Z`);
  const first = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const length = Math.ceil(((end.getTime() - start.getTime()) / 86400000 + 1) / 7) * 7;
  const values = new Map(data.value?.tokens.map((t) => [t.date, t.value]));
  let sum = 0;
  const cells = Array.from({ length }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000),
      date = dateKey(d),
      value = values.get(date) || 0;
    sum += value;
    return {
      date,
      raw: value,
      value: mode.value === 'total' ? sum : value,
      valid: d >= first && d <= end,
      month: d.getUTCDate() === 1 ? d.getUTCMonth() + 1 : 0,
    };
  });
  if (mode.value === 'week')
    for (let i = 0; i < cells.length; i += 7) {
      const total = cells.slice(i, i + 7).reduce((n, c) => n + c.raw, 0);
      for (const c of cells.slice(i, i + 7)) c.value = total;
    }
  return {
    cells,
    columns: length / 7,
    first: dateKey(first),
    end: dateKey(end),
    max: Math.max(1, ...cells.map((c) => c.value)),
  };
});
const heatmapIdentity = computed(() => `${mode.value}|${calendar.value.cells
  .filter((cell) => cell.valid)
  .map((cell) => `${cell.date}:${cell.value}`)
  .join('|')}`);
const selectedDay = ref<{ date: string; value: number } | null>(null);
const heatTooltip = ref({ left: 0, top: 0 });
function showDay(event: Event, cell: { date: string; value: number }) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  selectedDay.value = cell;
  heatTooltip.value = {
    left: Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2)),
    top: rect.top < 80 ? rect.bottom + 12 : rect.top - 64,
  };
}
function hideDay() {
  selectedDay.value = null;
}
const heatColors = [
  'var(--profile-empty-cell)',
  '#d8eaff',
  '#a8d2ff',
  '#61adff',
  '#1684ff',
  '#0054a8',
];
function cellColor(value: number) {
  return heatColors[value ? Math.max(1, Math.ceil((value / calendar.value.max) * 5)) : 0];
}
const compact = (n: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
const tokenTotal = computed(() => data.value?.tokens.reduce((n, t) => n + t.value, 0) || 0);
const monthTotal = computed(
  () =>
    data.value?.tokens
      .filter((t) => t.date.startsWith((data.value?.today || today).slice(0, 7)))
      .reduce((n, t) => n + t.value, 0) || 0,
);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api<Overview>('/account/overview');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function edit() {
  draftName.value = name.value;
  draftAvatar.value = currentAccount.value?.avatar || '';
  editError.value = '';
  editing.value = true;
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  ) {
    editError.value = '请选择5MB以内的 PNG、JPEG 或 WebP 图片';
    return;
  }
  processing.value = true;
  editError.value = '';
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 256, 256);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    draftAvatar.value = canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    editError.value = '无法读取此图片，请换一张重试';
  } finally {
    URL.revokeObjectURL(url);
    processing.value = false;
  }
}
async function save() {
  if (!draftName.value.trim() || [...draftName.value.trim()].length > 40) {
    editError.value = '姓名须为1–40个字符';
    return;
  }
  saving.value = true;
  editError.value = '';
  try {
    currentAccount.value = await api<Account>(
      '/account/profile',
      json('PUT', { displayName: draftName.value, avatar: draftAvatar.value }),
    );
    editing.value = false;
    message.value = '个人资料已保存';
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message.value = '';
    }, 3000);
  } catch (e) {
    editError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
onMounted(() => {
  window.addEventListener('scroll', hideDay, true);
  window.addEventListener('resize', hideDay);
  void load();
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', hideDay, true);
  window.removeEventListener('resize', hideDay);
  themeObserver.disconnect();
  clearTimeout(messageTimer);
});
</script>

<template>
  <main class="personal-center" aria-label="个人中心">
    <header class="personal-breadcrumb">
      <div>
        <button
          class="icon-button profile-mobile-menu"
          aria-label="打开导航栏"
          @click="emit('menu')"
        >
          <Menu :size="20" /></button
        ><span>学术审稿</span><ChevronRight :size="15" /><strong>个人中心</strong>
      </div>
      <div class="profile-toolbar">
        <button class="icon-button" aria-label="刷新数据" :disabled="loading" @click="load">
          <RefreshCw :size="16" /></button
        ><button
          class="icon-button"
          aria-label="账号菜单"
          title="账号与退出登录"
          @click="emit('account')"
        >
          <LogOut :size="17" />
        </button>
      </div>
    </header>
    <div
      v-catalog-wave="{ active: !loading, layout: 'profile', identity: 'real' }"
      class="personal-content"
    >
      <section class="personal-identity">
        <button class="personal-avatar" aria-label="更换头像" @click="edit">
          <img v-if="currentAccount?.avatar" :src="currentAccount.avatar" alt="个人头像" /><span
            v-else
            >{{ [...name][0] }}</span
          ><i><Camera :size="17" /></i>
        </button>
        <div>
          <div class="personal-name">
            <h1>{{ name }}</h1>
            <button class="icon-button" aria-label="修改姓名" @click="edit">
              <Pencil :size="20" />
            </button>
          </div>
          <p>个人资料与研究数据</p>
        </div>
        <button class="primary-button personal-edit" @click="edit">
          <Pencil :size="17" />编辑资料
        </button>
      </section>
      <p v-if="message" class="profile-success" role="status">{{ message }}</p>
      <div v-if="loading && !data" class="profile-loading" role="status">正在加载研究数据…</div>
      <div v-if="error" class="profile-error" role="alert">
        {{ error }} <button @click="load">重新加载</button>
      </div>
      <template v-if="data">
        <div class="profile-data-note">
          当前账号数据 · 按各论文当前版本统计<span
            >更新于 {{ new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}</span
          >
        </div>
        <section class="personal-metrics" aria-label="研究数据概览">
          <div>
            <span>审阅论文</span><strong>{{ data.metrics.reviewed }}</strong>
          </div>
          <div>
            <span>待处理问题</span><strong>{{ data.metrics.pending }}</strong>
          </div>
          <div>
            <span>已完成修改</span><strong>{{ data.metrics.resolved }}</strong>
          </div>
          <div>
            <span>收藏文献</span><strong>{{ data.metrics.starred }}</strong>
          </div>
        </section>
        <section
          class="personal-heatmap"
          :style="{ '--profile-columns': calendar.columns }"
        >
          <div class="profile-section-heading">
            <h2>年度 Token 用量</h2>
            <div class="profile-heat-controls" role="group" aria-label="Token统计方式">
              <button
                v-for="item in [
                  ['day', '日'],
                  ['week', '周'],
                  ['total', '累计'],
                ] as const"
                :key="item[0]"
                :aria-pressed="mode === item[0]"
                @click="
                  mode = item[0];
                  selectedDay = null;
                "
              >
                {{ item[1] }}
              </button>
            </div>
            <div class="profile-heat-legend">
              <span>低</span
              ><i v-for="color in heatColors" :key="color" :style="{ background: color }" /><span
                >高</span
              >
            </div>
          </div>
          <div
            class="profile-heat-scroll"
            @scroll="hideDay"
            @mouseleave="hideDay"
            @keydown.esc="hideDay"
          >
            <div
              v-heatmap-motion="heatmapIdentity"
              class="profile-heat-grid"
              :style="{
                gridTemplateColumns: `repeat(${calendar.columns}, var(--profile-cell-size))`,
              }"
            >
              <button
                v-for="(cell, cellIndex) in calendar.cells"
                :key="cell.date"
                class="profile-heat-cell"
                :style="{
                  gridColumn: Math.floor(cellIndex / 7) + 1,
                  gridRow: (cellIndex % 7) + 1,
                  visibility: cell.valid ? 'visible' : 'hidden',
                }"
                :disabled="!cell.valid"
                :aria-label="`${cell.date} ${mode === 'day' ? '当日' : mode === 'week' ? '当周' : '累计'} ${cell.value.toLocaleString()} Tokens`"
                @mouseenter="showDay($event, cell)"
                @focus="showDay($event, cell)"
                @blur="hideDay"
                @click="showDay($event, cell)"
              >
                <span
                  class="profile-heat-dot"
                  aria-hidden="true"
                  :style="{ background: cellColor(cell.value) }"
                />
              </button>
              <div
                v-for="(cell, i) in calendar.cells"
                :key="`month-${cell.date}`"
                v-show="cell.month"
                class="profile-heat-month"
                :style="{ gridRow: 8, gridColumn: Math.floor(i / 7) + 1 }"
              >
                {{ cell.month }}月
              </div>
            </div>
          </div>
          <div class="profile-heat-summary">
            <span
              >累计 {{ compact(tokenTotal) }} Tokens · 本月 {{ compact(monthTotal) }} Tokens</span
            ><span>{{ calendar.first.slice(0, 7) }} — {{ calendar.end.slice(0, 7) }}</span>
          </div>
          <Teleport to="body"
            ><div
              v-if="selectedDay"
              class="profile-heat-detail"
              role="status"
              :style="{ left: `${heatTooltip.left}px`, top: `${heatTooltip.top}px` }"
            >
              <span
                >{{ selectedDay.date
                }}{{ mode === 'week' ? ' · 当周' : mode === 'total' ? ' · 累计' : '' }}</span
              ><strong>{{ selectedDay.value.toLocaleString() }} <span>Tokens</span></strong>
            </div></Teleport
          >
        </section>
        <section class="personal-charts">
          <div class="personal-trend">
            <div class="profile-section-heading">
              <h2>修改进展</h2>
              <div class="profile-line-legend">
                <span><i style="background: #0866f5" />新发现问题</span
                ><span><i style="background: #12b9ba" />已解决问题</span>
              </div>
              <select v-model="period" class="profile-period" aria-label="趋势时间范围">
                <SelectContent />
                <option :value="7">最近7天</option>
                <option :value="30">最近30天</option>
                <option :value="90">最近90天</option>
              </select>
            </div>
            <PersonalChart
              :option="lineOption"
              label="问题发现与解决趋势，左右方向键查看每日数据"
              :points="seriesDays.length"
            />
          </div>
        </section>
      </template>
    </div>
    <Modal v-if="editing" title="编辑个人资料" @close="!saving && !processing && (editing = false)"
      ><form class="personal-form" @submit.prevent="save">
        <div class="profile-avatar-editor">
          <button
            type="button"
            class="personal-avatar"
            aria-label="选择头像图片"
            :disabled="processing || saving"
            @click="fileInput?.click()"
          >
            <img v-if="draftAvatar" :src="draftAvatar" alt="头像预览" /><span v-else>{{
              [...draftName][0] || '研'
            }}</span
            ><i><Camera :size="17" /></i>
          </button>
          <div>
            <button
              type="button"
              class="secondary-button"
              :disabled="processing || saving"
              @click="fileInput?.click()"
            >
              {{ processing ? '正在处理…' : '更换头像' }}
            </button>
            <p>PNG、JPEG、WebP，最大5MB</p>
            <button
              v-if="draftAvatar"
              type="button"
              class="profile-text-button"
              :disabled="processing || saving"
              @click="draftAvatar = ''"
            >
              移除头像
            </button>
          </div>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          @change="upload"
        /><label
          >姓名<input
            v-model="draftName"
            autocomplete="name"
            maxlength="80"
            :disabled="saving"
            autofocus
        /></label>
        <p class="profile-caption">姓名用于显示，登录账号保持不变。</p>
        <p v-if="editError" role="alert" class="profile-error">{{ editError }}</p>
        <div class="profile-form-actions">
          <button
            type="button"
            class="secondary-button"
            :disabled="saving || processing"
            @click="editing = false"
          >
            取消</button
          ><button class="primary-button" :disabled="saving || processing">
            {{ saving ? '正在保存…' : '保存修改' }}
          </button>
        </div>
      </form></Modal
    >
  </main>
</template>
