import type { HttpClient } from '../http/client';
import type { AttestationIssuerResolutionResponse } from '../types';

/**
 * Serviço de consulta do participante público vinculado a uma attestation.
 *
 * @internal Não instanciar diretamente — use o `VestaSDK` como ponto de entrada.
 */
export class AttestationsService {
  constructor(private readonly http: HttpClient) {}

  /**
   * Resolve o DID imutável da attestation contra o registry Soroban atual.
   *
   * O resultado pode indicar que o DID não está disponível, que ainda não foi
   * registrado, ou que o participante está ativo ou suspenso. A resposta não
   * expõe o identificador interno do emissor nem dados sensíveis.
   *
   * @throws {VestaSDKError} 401 para API key inválida, 404 para attestation
   * inexistente e 503 se o registry estiver indisponível.
   */
  async resolveIssuer(attestationId: string): Promise<AttestationIssuerResolutionResponse> {
    return this.http.get<AttestationIssuerResolutionResponse>(
      `/public/attestations/${encodeURIComponent(attestationId)}/issuer`,
    );
  }
}
