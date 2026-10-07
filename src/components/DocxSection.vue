<script setup lang="ts">
import { computed } from 'vue';
import type { Section, Anchor, DocxTextRun } from '../types';
import { quoteRange, textSegments } from '../../shared/text-highlight.js';

const props = defineProps<{ section: Section; anchor: Anchor | null }>();
const range = computed(() =>
  props.anchor?.elementId === props.section.id
    ? quoteRange(props.section.text, props.anchor)
    : null,
);
function parts(text: string, offset = 0, runs?: DocxTextRun[]) {
  return (runs || [{ text, offset: 0 }]).flatMap((run) =>
    textSegments(run.text, offset + run.offset, range.value).map((part) => ({
      ...part,
      class: {
        'docx-bold': run.bold,
        'docx-italic': run.italic,
        'docx-sup': run.script === 'sup',
        'docx-sub': run.script === 'sub',
      },
    })),
  );
}
</script>

<template>
  <div :id="section.id" class="docx-paragraph" :class="{ 'docx-table-section': section.table }">
    <div
      v-if="section.table"
      class="docx-table-scroll"
      tabindex="0"
      role="region"
      :aria-label="section.title"
    >
      <table class="docx-table">
        <caption>
          {{
            section.title
          }}
        </caption>
        <tbody>
          <tr v-for="(row, rowIndex) in section.table.rows" :key="rowIndex">
            <component
              :is="cell.header ? 'th' : 'td'"
              v-for="cell in row.cells"
              :key="cell.column"
              :colspan="cell.columnSpan"
              :rowspan="cell.rowSpan"
              :scope="cell.header ? 'col' : undefined"
              :data-column="cell.column"
              :data-offset="cell.offset"
              ><template
                v-for="(part, partIndex) in parts(cell.text, cell.offset, cell.runs)"
                :key="partIndex"
                ><span :class="part.class"
                  ><mark v-if="part.highlight">{{ part.text }}</mark
                  ><template v-else>{{ part.text }}</template></span
                ></template
              ></component
            >
          </tr>
        </tbody>
      </table>
    </div>
    <template v-else>
      <small>{{ section.title === section.text ? '' : section.title }}</small>
      <p :class="{ 'docx-heading': section.title === section.text }">
        <template v-for="(part, index) in parts(section.text, 0, section.runs)" :key="index"
          ><span :class="part.class"
            ><mark v-if="part.highlight">{{ part.text }}</mark
            ><template v-else>{{ part.text }}</template></span
          ></template
        >
      </p>
    </template>
  </div>
</template>
