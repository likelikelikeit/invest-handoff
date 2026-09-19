import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app") });

// PWA: 배포본에서만 서비스 워커를 등록한다 (개발 서버에서는 캐시 혼선을 피한다).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {});
}
