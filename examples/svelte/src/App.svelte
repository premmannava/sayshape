<script>
  import { sayshape } from "sayshape/svelte";

  const spec = `state days=2 hikers=3
card
  text "Yosemite weekend" style=title
  row
    stat label="Days" value={days}
    stat label="Water (L)" value={days * hikers * 3}
  button "Add day" on=inc:days
  button "Book it" on=emit:book:{days}`;

  let theme = $state("auto");
  let last = $state("Press Book it.");
</script>

<main>
  <h1>SayShape in Svelte</h1>
  <label>
    Theme
    <select bind:value={theme}>
      <option>auto</option>
      <option>light</option>
      <option>dark</option>
    </select>
  </label>
  <div use:sayshape={{ spec, theme, onAction: (e) => (last = `action ${e.name}: ${e.value}`) }}></div>
  <p>{last}</p>
</main>

<style>
  main { max-width: 640px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
</style>
