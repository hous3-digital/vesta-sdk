/**
 * Fábrica de instâncias do VestaSDK para o demo.
 *
 * Centraliza a configuração de conexão com a vesta-api-stellar rodando
 * localmente em modo mock. Em produção, substitua `apiUrl` e `apiKey`
 * pelas credenciais reais do integrador.
 */
import { VestaSDK } from '@hous3-digital/vesta-sdk';

/**
 * Cria uma instância configurada do VestaSDK para o ambiente de demo.
 *
 * @param issuerId - ID do integrador (banco/seguradora) enviado no header
 *   `X-Vesta-Issuer-ID`. Ex: "banco_vesta_digital" ou "vesta_seguros".
 * @returns Instância pronta para uso com a API local em mock mode.
 *
 * @example
 * import { createSDK } from './sdk-config';
 * const sdk = createSDK('banco_vesta_digital');
 * const hasVC = await sdk.hasStoredCredential();
 */
export function createSDK(issuerId: string): VestaSDK {
  return new VestaSDK({
    apiUrl: 'http://localhost:3000/api/v1',
    apiKey: 'dev-secret-key',
    issuerId,
  });
}
