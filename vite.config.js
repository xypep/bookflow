import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// The camera capture used by the scanner needs a secure context, which a plain
// http origin on the local network is not. `npm run dev:https` serves over TLS
// with a throwaway certificate so it can be exercised on a phone; the regular
// dev server stays on http.
export default defineConfig(({ mode }) => ({
  plugins: mode === "https" ? [basicSsl()] : [],
}));
