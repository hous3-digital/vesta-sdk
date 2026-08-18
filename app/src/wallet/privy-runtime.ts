/**
 * Entry point do chunk Privy gerado no build. Ele fica separado do entrypoint
 * principal para preservar o carregamento sob demanda do SDK.
 */
export { default, LocalStorage, rawSign } from '@privy-io/js-sdk-core';
