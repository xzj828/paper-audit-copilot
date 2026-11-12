<template>
  <svg
    class="research-welcome"
    width="64"
    height="56"
    viewBox="0 0 80 70"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M35 18c-8-5-17-6-26-4v36c9-2 18 0 26 5l6-3M35 18c8-5 17-6 26-4v15M35 19v35"
    />
    <path d="M17 25c4 0 7 1 11 3M17 33c4 0 7 1 11 3" />
    <circle cx="56" cy="45" r="12" />
    <path d="m65 54 8 8" />
  </svg>
</template>

<style scoped>
.research-welcome {
  display: block;
  flex-shrink: 0;
  color: #737373;
}
:global(:root[data-theme='dark'] .research-welcome) {
  color: #a8a8a8;
}
</style>
