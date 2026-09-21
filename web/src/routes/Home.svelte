<script>
  // 홈 (SPEC §4.2): 1 시장 띠, 2 자산 요약, 3 투자의견, 4 다가오는 일정, 5 거시. 4·5는 기본 접힘 [제안].
  import PageHead from "../components/PageHead.svelte";
  import Gate from "../components/Gate.svelte";
  import Section from "../components/Section.svelte";
  import AssetSummary from "../components/AssetSummary.svelte";
  import QuoteStamp from "../components/QuoteStamp.svelte";
  import MarketStrip from "../components/MarketStrip.svelte";
  import ViewsBlock from "../components/ViewsBlock.svelte";
  import UpcomingBlock from "../components/UpcomingBlock.svelte";
  import MacroBlock from "../components/MacroBlock.svelte";
  import DraftsBlock from "../components/DraftsBlock.svelte";
  import NotesBlock from "../components/NotesBlock.svelte";
  import { ui } from "../lib/ui.svelte.js";
  import { data, holdings, cash } from "../lib/data.svelte.js";
</script>

<PageHead title="홈" />

<Gate>
  <QuoteStamp />
  {#if data.drafts.length}
    <Section id="home-drafts" title="가져오기 대기" note="{data.drafts.length}건 · 반영하면 앱에 들어갑니다">
      <DraftsBlock />
    </Section>
  {/if}
  {#if data.market.length}
    <Section id="home-market" title="시장">
      <MarketStrip />
    </Section>
  {/if}
  <Section id="home-assets" title="자산">
    <AssetSummary holdings={holdings()} cash={cash()} />
  </Section>
  <Section id="home-views" title="투자의견" note="지금 상승여력 순">
    {#snippet aside()}<button class="btn sm" onclick={() => (ui.viewForm = {})}>기록</button>{/snippet}
    <ViewsBlock />
  </Section>
  <Section id="home-notes" title="테마·메모" note="최근" defaultOpen={false}>
    <NotesBlock />
  </Section>
  <Section id="home-events" title="다가오는 일정" note="30일" defaultOpen={false}>
    <UpcomingBlock />
  </Section>
  <Section id="home-macro" title="거시" note="기준금리 · 금리 경로" defaultOpen={false}>
    <MacroBlock />
  </Section>
</Gate>
