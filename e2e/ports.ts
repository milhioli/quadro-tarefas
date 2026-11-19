/**
 * Portas e URL do servidor de teste. Ficam fora do playwright.config.ts porque
 * importar o config cria uma pasta temporária; as fixtures importam daqui.
 */
export const API_PORT = 3101;
export const WEB_PORT = 5273;
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
