import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// GitHub Pages는 https://likelikelikeit.github.io/invest-handoff/ 아래에 뜬다.
export default defineConfig(({ mode }) => ({
  base: "/invest-handoff/",
  plugins: [svelte()],
  // Vitest(jsdom)에서 svelte의 서버 빌드 대신 브라우저 빌드를 쓰게 한다.
  resolve: mode === "test" ? { conditions: ["browser"] } : undefined,
  test: {
    environment: "jsdom",
  },
}));
