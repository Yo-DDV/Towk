<script lang="ts">
  let { children } = $props();
</script>

<div data-testid="chat-chrome">
  {@render children?.()}
</div>
