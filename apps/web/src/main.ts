import { mount } from "svelte";
import App from "./App.svelte";
import { registerServiceWorker } from "./lib/pwa.svelte";
import "./fonts.css";
import "./app.css";

mount(App, { target: document.getElementById("app")! });

// 빌드한 앱에서만 오프라인 캐시를 켠다 (개발 중에는 옛 파일이 남아 헷갈리지 않게)
if (import.meta.env.PROD) registerServiceWorker();
