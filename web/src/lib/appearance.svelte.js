import { store } from "./storage.js";

const ASSET_STYLE_KEY = "invest.appearance.assetSplit";
const saved = store.get(ASSET_STYLE_KEY, "compact");

export const appearance = $state({
  assetSplit: saved === "labels" ? "labels" : "compact",
});

export function setAssetSplit(value) {
  appearance.assetSplit = value === "labels" ? "labels" : "compact";
  store.set(ASSET_STYLE_KEY, appearance.assetSplit);
}
