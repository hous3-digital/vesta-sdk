import type { HttpClient } from '../http/client';
import type {
  GenerateAndSubmitResponse,
  PrepareProofRequest,
  PrepareProofResponse,
  SubmitProofRequest,
  SubmitSignedProofRequest,
} from '../types';

/**
 * Serviço responsável pela submissão de provas ZK à vesta-api.
 *
 * A partir da v2.0.0 o fluxo principal é two-phase:
 *   1. `prepare` — backend gera a prova ZK e devolve uma tx Soroban não-assinada.
 *   2. `submitSigned` — backend recebe a tx assinada, envolve em fee-bump (Vesta
 *      paga as fees) e submete ao Soroban.
 *
 * Mantém também `submit` para o caso de uso de prova externa pré-computada.
 *
 * @internal Não instanciar diretamente — use o `VestaSDK` como ponto de entrada.
 */
export class ProofsService {
  constructor(private readonly http: HttpClient) {}

  /**
   * Fase 1 — gera prova ZK no backend e retorna a tx Soroban unsigned.
   *
   * Quando `requiresUserSignature: true`, o SDK deve assinar com a wallet
   * Privy do usuário antes de chamar `submitSigned`. Quando false, o
   * backend já assinou internamente e o SDK apenas repassa o XDR.
   */
  async prepare(req: PrepareProofRequest): Promise<PrepareProofResponse> {
    return this.http.post<PrepareProofRequest, PrepareProofResponse>(
      '/public/proof/prepare',
      req,
    );
  }

  /**
   * Fase 2 — envia a tx (assinada ou repassada) ao backend, que envolve em
   * fee-bump e submete ao Soroban. Retorna o resultado on-chain completo.
   */
  async submitSigned(req: SubmitSignedProofRequest): Promise<GenerateAndSubmitResponse> {
    return this.http.post<SubmitSignedProofRequest, GenerateAndSubmitResponse>(
      '/public/proof/submit-signed',
      req,
    );
  }

  /**
   * Submete uma prova Groth16 já gerada externamente ao contrato Soroban.
   * Caso de uso paralelo ao fluxo two-phase — usado quando a prova vem de
   * um ambiente externo (ex: gerador server-side de uma instituição).
   */
  async submit(req: SubmitProofRequest): Promise<GenerateAndSubmitResponse> {
    return this.http.post<SubmitProofRequest, GenerateAndSubmitResponse>(
      '/public/proof/submit',
      req,
    );
  }
}
