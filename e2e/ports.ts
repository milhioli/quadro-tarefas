/**
 * Portas e URL do servidor de teste. Ficam fora do playwright.config.ts porque
 * importar o config cria uma pasta temporária; as fixtures importam daqui.
 */
export const API_PORT = 3101;
export const WEB_PORT = 5273;
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
/**
 * Projeto `producao`: o build do web servido pelo próprio Fastify (e2eEntry --static),
 * numa porta só, com a CSP estrita do HTML.
 */
export const PROD_PORT = 3201;
export const PROD_URL = `http://127.0.0.1:${PROD_PORT}`;
