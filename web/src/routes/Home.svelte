<script>
  // 홈 (SPEC §4.2). M2에는 블록 2(자산 요약)만. 시장 띠(M3), 의견(M4), 일정·거시(M7)는 해당 마일스톤에서 붙는다.
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import Section from "../components/Section.svelte";
  import AssetSummary from "../components/AssetSummary.svelte";
  import QuoteStamp from "../components/QuoteStamp.svelte";
  import { holdings, cash } from "../lib/data.svelte.js";
</script>

<PageHead title="홈" />

<Gate>
  <QuoteStamp />
  <Section id="home-assets" title="자산">
    <AssetSummary holdings={holdings()} cash={cash()} />
  </Section>
</Gate>
