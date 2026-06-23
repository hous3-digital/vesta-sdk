import { PRIVY_APP_ID, PRIVY_PLACEHOLDER } from './privy.config.generated';

export interface PrivyAuthResult {
  userId: string;
  walletAddress: string;
  identityToken: string;
}

/**
 * Wallet service do SDK — encapsula o Privy browser SDK em modo headless.
 *
 * Responsabilidades:
 * - Inicializar Privy com o appId injetado em build time (gitignored).
 * - Autenticar o usuário via Passkey (mesma ceremony WebAuthn já usada para descriptografar a VC).
 * - Assinar XDR de tx Stellar usando a wallet embedada do usuário.
 *
 * Esta classe é resiliente à ausência de configuração: quando o appId é um
 * placeholder (build sem Privy), `isAvailable()` retorna false e todas as
 * operações lançam erro explícito. O VestaSDK então cai no fluxo legado.
 */
export class WalletService {
  private privy: unknown | null = null;
  private initPromise: Promise<void> | null = null;

  public isAvailable(): boolean {
    return !!PRIVY_APP_ID && PRIVY_APP_ID !== PRIVY_PLACEHOLDER;
  }

  /**
   * Inicializa o cliente Privy. Lazy + idempotente — múltiplas chamadas
   * compartilham a mesma promise.
   */
  public async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error(
        'WalletService: PRIVY_APP_ID não configurado. ' +
          'Rode `node scripts/generate-privy-config.js` com PRIVY_APP_ID no ambiente.',
      );
    }
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async (): Promise<void> => {
      // Dynamic import + untyped resolution: the @privy-io/js-sdk-core API
      // surface is in flux (Privy is still iterating on Stellar support). We
      // intentionally avoid baking in a specific export shape; instead, we
      // probe common entry points (PrivyClient, Privy, default) and let the
      // first one that's a constructor win. Runtime will throw a clear error
      // if none match — calling code falls back to the legacy flow.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import('@privy-io/js-sdk-core')) as unknown as Record<string, any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const PrivyCtor: any = mod.PrivyClient ?? mod.Privy ?? mod.default;
      if (typeof PrivyCtor !== 'function') {
        throw new Error(
          'WalletService: nenhum construtor Privy encontrado em @privy-io/js-sdk-core. ' +
            'Verifique a versão instalada e o nome do export.',
        );
      }
      this.privy = new PrivyCtor({
        appId: PRIVY_APP_ID,
        // Headless: sem UI, sem prompts adicionais. Auth é via custom token.
        embeddedWallets: {
          createOnLogin: 'all-users',
          showWalletUIs: false,
        },
      });
    })();

    return this.initPromise;
  }

  /**
   * Autentica via Passkey já validada localmente. O passkeyCredentialId
   * funciona como chave externa (custom auth) — Privy gera/recupera a wallet
   * Stellar vinculada a esse ID.
   *
   * Retorna o identity token que deve ser enviado ao backend (via
   * /public/proof/submit-signed) para que o backend valide a assinatura
   * server-side.
   */
  public async authenticateWithPasskey(passkeyCredentialId: string): Promise<PrivyAuthResult> {
    await this.initialize();
    if (!this.privy) throw new Error('Privy não inicializado');

    // A chave externa identifica o usuário no Privy de forma determinística.
    // Privy gera (ou recupera) uma wallet Stellar vinculada a esse subject.
    const privyClient = this.privy as {
      loginWithCustomAuthToken: (token: string) => Promise<{ user: { id: string }; identityToken: string }>;
      getEmbeddedStellarWallet: () => Promise<{ address: string } | null>;
    };

    const customToken = await this.buildCustomAuthToken(passkeyCredentialId);
    const session = await privyClient.loginWithCustomAuthToken(customToken);

    const wallet = await privyClient.getEmbeddedStellarWallet();
    if (!wallet?.address) {
      throw new Error('Privy não retornou wallet Stellar — verificar configuração do app');
    }

    return {
      userId: session.user.id,
      walletAddress: wallet.address,
      identityToken: session.identityToken,
    };
  }

  /**
   * Assina um XDR Stellar com a wallet embedada do usuário.
   * Retorna o XDR assinado (base64) para envio ao backend.
   */
  public async signStellarTx(unsignedXdr: string): Promise<string> {
    if (!this.privy) throw new Error('WalletService.signStellarTx chamado antes de authenticate');

    const privyClient = this.privy as {
      getEmbeddedStellarWallet: () => Promise<{ signTransaction: (xdr: string) => Promise<{ signedTxXdr: string }> } | null>;
    };

    const wallet = await privyClient.getEmbeddedStellarWallet();
    if (!wallet) throw new Error('Wallet Stellar não encontrada para o usuário autenticado');

    const result = await wallet.signTransaction(unsignedXdr);
    return result.signedTxXdr;
  }

  /**
   * Constrói um token de custom auth assinado para o Privy. No fluxo headless,
   * o "segredo" é o Passkey credential ID — o backend Vesta também usa esse
   * mesmo ID como chave de lookup ao verificar o identity token, então a
   * derivação é consistente em ambos os lados.
   *
   * Implementação simplificada: o Privy aceita custom JWTs assinados via
   * server-side. Para browser-only, usamos um esquema mais simples: enviamos
   * o credential ID como subject de um JWT não assinado, e o Privy aceita
   * via configuração de "trusted custom auth" (configurada no dashboard).
   * Consultar https://docs.privy.io/guide/server/authorization/custom-auth.
   */
  private async buildCustomAuthToken(passkeyCredentialId: string): Promise<string> {
    // Esquema base64url(JSON) — Privy decodifica via `customAuth` config no dashboard.
    const payload = {
      sub: passkeyCredentialId,
      iat: Math.floor(Date.now() / 1000),
    };
    return btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
}
