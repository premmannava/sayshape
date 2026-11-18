<script setup>
import { ref } from "vue";
import { SayShape } from "sayshape/vue";

const spec = ref(`state days=2 hikers=3
card
  text "Yosemite weekend" style=title
  row
    stat label="Days" value={days}
    stat label="Water (L)" value={days * hikers * 3}
  button "Add day" on=inc:days
  button "Book it" on=emit:book:{days}`);

const theme = ref("auto");
const last = ref("Press Book it.");

function onAction(e) {
  last.value = `action ${e.name}: ${e.value}`;
}
</script>

<template>
  <main style="max-width: 640px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif">
    <h1>SayShape in Vue</h1>
    <label>
      Theme
      <select v-model="theme">
        <option>auto</option>
        <option>light</option>
        <option>dark</option>
      </select>
    </label>
    <SayShape :spec="spec" :theme="theme" @action="onAction" />
    <p>{{ last }}</p>
  </main>
</template>
