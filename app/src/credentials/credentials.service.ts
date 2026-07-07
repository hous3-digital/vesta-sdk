import type { HttpClient } from '../http/client';
import type {
  IssueCredentialRequest,
  IssueCredentialResponse,
  RevokeCredentialRequest,
  RevokeCredentialResponse,
  VerifyCredentialRequest,
  VerifyCredentialResponse,
} from '../types';

/**
 * Serviço responsável por todas as operações de credencial da vesta-api.
 *
 * Encapsula as chamadas aos endpoints `/public/credential`, `/public/credential/verify`
 * e `/public/credential/revoke`, delegando a autenticação e o transporte HTTP
 * ao `HttpClient` injetado.
 *
 * @internal Não instanciar diretamente — use o `VestaSDK` como ponto de entrada.
 */
export class CredentialsService {
  /**
   * @param http - Cliente HTTP pré-configurado com API key e URL base.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Emite uma nova Credencial Verificável (VC) para o titular informado.
   *
   * A API calcula os hashes Poseidon dos dados de PII e persiste a VC no banco.
   * Os dados brutos (CPF, nome, data) nunca são armazenados ou retornados.
   *
   * @param req - Dados de identidade e KYC do titular.
   * @returns VC emitida, vcHash, credentialId e metadados de expiração.
   * @throws {VestaSDKError} 400 se os dados forem inválidos.
   *
   * @example
   * const result = await service.issue({
   *   cpf: '12345678900',
   *   fullName: 'João da Silva',
   *   birthDate: '1990-03-15',
   *   kycLevel: 'complete',
   *   kycMethod: 'biometric_plus_document',
   * });
   * console.log(result.vcHash); // "a1b2c3..."
   */
  async issue(req: IssueCredentialRequest): Promise<IssueCredentialResponse> {
    return this.http.post<IssueCredentialRequest, IssueCredentialResponse>('/public/credential', req);
  }

  /**
   * Consulta o status de uma credencial pelo seu hash SHA-256.
   *
   * Não requer autenticação — pode ser chamado pelo lado do verificador
   * para checar validade antes de iniciar o fluxo ZK.
   *
   * @param req - Objeto com o `vcHash` a ser verificado.
   * @returns Status de validade, nível de KYC e nonce de desafio (se válida).
   * @throws {VestaSDKError} 404 se a credencial não existir.
   *
   * @example
   * const status = await service.verify({ vcHash: 'a1b2c3...' });
   * if (!status.valid) {
   *   console.warn('Credencial inválida:', status.reason);
   * }
   */
  async verify(req: VerifyCredentialRequest): Promise<VerifyCredentialResponse> {
    return this.http.post<VerifyCredentialRequest, VerifyCredentialResponse>(
      '/public/credential/verify',
      req,
    );
  }

  /**
   * Revoga uma credencial existente, tornando-a permanentemente inválida.
   *
   * Após a revogação, todas as verificações ZK dessa VC falharão.
   * A operação é irreversível.
   *
   * @param req - Hash da VC a revogar e motivo opcional.
   * @returns Confirmação da revogação com status atualizado.
   * @throws {VestaSDKError} 404 se a credencial não existir.
   * @throws {VestaSDKError} 400 se a credencial já estiver revogada.
   *
   * @example
   * await service.revoke({ vcHash: 'a1b2c3...', reason: 'fraudulent_documents' });
   */
  async revoke(req: RevokeCredentialRequest): Promise<RevokeCredentialResponse> {
    return this.http.post<RevokeCredentialRequest, RevokeCredentialResponse>(
      '/public/credential/revoke',
      req,
    );
  }
}
