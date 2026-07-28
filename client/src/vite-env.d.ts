/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the game server, e.g. https://spoider-man.onrender.com.
   * Unset in local dev, where the Vite proxy handles /socket.io instead.
   */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
