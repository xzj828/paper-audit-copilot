import { defineComponent, h } from 'vue';

// Native selectedcontent mirrors the chosen option without duplicating selection state.
// The inner text may shrink independently, so long names never cover the chevron.
export default defineComponent({
  name: 'SelectContent',
  setup: () => () =>
    h('button', { type: 'button', class: 'select-value' }, [
      h('selectedcontent', { class: 'select-value-text' }),
    ]),
});
