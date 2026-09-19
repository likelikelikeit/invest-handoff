<script>
  // 홈 (SPEC §4.2): 블록 1 시장 띠, 블록 2 자산 요약. 의견(M4), 일정·거시(M7)는 해당 마일스톤에서 붙는다.
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import Section from "../components/Section.svelte";
  import AssetSummary from "../components/AssetSummary.svelte";
  import QuoteStamp from "../components/QuoteStamp.svelte";
  import MarketStrip from "../components/MarketStrip.svelte";
  import { data, holdings, cash } from "../lib/data.svelte.js";
</script>

<PageHead title="홈" />

<Gate>
  <QuoteStamp />
  {#if data.market.length}
    <Section id="home-market" title="시장">
      <MarketStrip />
    </Section>
  {/if}
  <Section id="home-assets" title="자산">
    <AssetSummary holdings={holdings()} cash={cash()} />
  </Section>
</Gate>
