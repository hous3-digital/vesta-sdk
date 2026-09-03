import { PRIVY_APP_ID, PRIVY_PLACEHOLDER } from './privy.config.generated';

export interface PrivyAuthResult {
  userId: string;
  walletAddress: string;
  accessToken: string;
}

interface StellarWalletAccount {
  id: string;
  address: string;
  chain_type: 'stellar';
  type: 'wallet';
}

interface AuthenticatedPrivyUser {
  user: {
    id: string;
    linked_accounts?: Array<Record<string, unknown>>;
    linkedAccounts?: Array<Record<string, unknown>>;
  };
}

interface PrivyClientLike {
  app: { appId: string };
  auth: {
    customProvider: {
      syncWithToken: (token: string, options?: unknown, mode?: string) => Promise<AuthenticatedPrivyUser>;
    };
  };
  embeddedWallet: {
    getURL: () => string;
    onMessage: (event: unknown) => void;
    ping: (timeoutMs: number) => Promise<boolean>;
    signWithUserSigner: (input: { message: string }) => Promise<{ signature: string }>;
  };
  fetchPrivyRoute: (...args: unknown[]) => Promise<unknown>;
  getCompiledPath: (...args: unknown[]) => string;
  getAccessToken: () => Promise<string | null>;
  initialize: () => Promise<void>;
  setMessagePoster: (poster: {
    postMessage: (message: unknown, targetOrigin: string, transfer?: Transferable) => void;
    reload: () => void;
  }) => void;
}

interface PrivyModuleLike {
  default: new (options: { appId: string; storage: Storage }) => PrivyClientLike;
  LocalStorage: new () => Storage;
  rawSign: (
    context: {
      fetchPrivyRoute: PrivyClientLike['fetchPrivyRoute'];
      getCompiledPath: PrivyClientLike['getCompiledPath'];
      app: { appId: string };
    },
    sign: (input: { message: string }) => Promise<{ signature: string }>,
    input: { wallet_id: string; params: { hash: `0x${string}` } },
  ) => Promise<{ data: { signature: `0x${string}`; encoding: 'hex' } }>;
}

/** Integração headless Privy mantida no pacote principal e carregada sob demanda. */
export class WalletService {
  private privy: PrivyClientLike | null = null;
  private privyModule: PrivyModuleLike | null = null;
  private wallet: StellarWalletAccount | null = null;
  private initPromise: Promise<void> | null = null;

  public isAvailable(): boolean {
    return !!PRIVY_APP_ID && PRIVY_APP_ID !== PRIVY_PLACEHOLDER;
  }

  public async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error(
        'WalletService: PRIVY_APP_ID não configurado. ' +
          'Rode `node scripts/generate-privy-config.js` com PRIVY_APP_ID no ambiente.',
      );
    }
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async (): Promise<void> => {
      const mod = (await import('./privy-runtime')) as unknown as PrivyModuleLike;
      const privy = new mod.default({ appId: PRIVY_APP_ID, storage: new mod.LocalStorage() });
      await privy.initialize();
      await this.attachSecureIframe(privy);
      this.privyModule = mod;
      this.privy = privy;
    })();

    try {
      await this.initPromise;
    } catch (cause) {
      this.initPromise = null;
      throw cause;
    }
  }

  public async authenticateWithCustomAuthToken(customAuthToken: string): Promise<PrivyAuthResult> {
    await this.initialize();
    if (!this.privy) throw new Error('Privy não inicializado');
    if (!customAuthToken || customAuthToken.split('.').length !== 3) {
      throw new Error('Token Privy custom-auth inválido');
    }

    const session = await this.privy.auth.customProvider.syncWithToken(
      customAuthToken,
      undefined,
      'no-signup',
    );
    const wallet = this.findStellarWallet(session.user);
    if (!wallet) throw new Error('Privy não retornou a wallet Stellar pré-criada para o usuário');

    const accessToken = await this.privy.getAccessToken();
    if (!accessToken) throw new Error('Privy não retornou access token após custom auth');
    this.wallet = wallet;

    return { userId: session.user.id, walletAddress: wallet.address, accessToken };
  }

  public async signStellarTx(unsignedXdr: string, networkPassphrase: string): Promise<string> {
    if (!this.privy || !this.privyModule || !this.wallet) {
      throw new Error('WalletService.signStellarTx chamado antes de authenticate');
    }

    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const transaction = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase);
    const hash = `0x${Array.from(transaction.hash(), (byte) => byte.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
    const result = await this.privyModule.rawSign(
      {
        fetchPrivyRoute: this.privy.fetchPrivyRoute.bind(this.privy),
        getCompiledPath: this.privy.getCompiledPath.bind(this.privy),
        app: { appId: this.privy.app.appId },
      },
      (input) => this.privy!.embeddedWallet.signWithUserSigner(input),
      { wallet_id: this.wallet.id, params: { hash } },
    );

    const signatureBytes = result.data.signature
      .slice(2)
      .match(/.{2}/g)
      ?.map((byte) => String.fromCharCode(Number.parseInt(byte, 16)))
      .join('');
    if (!signatureBytes) throw new Error('Privy retornou assinatura Stellar vazia');
    const signatureBase64 = btoa(signatureBytes);
    transaction.addSignature(this.wallet.address, signatureBase64);
    return transaction.toXDR();
  }

  private findStellarWallet(user: AuthenticatedPrivyUser['user']): StellarWalletAccount | null {
    const accounts = user.linked_accounts ?? user.linkedAccounts ?? [];
    for (const account of accounts) {
      if (
        account.type === 'wallet' &&
        account.chain_type === 'stellar' &&
        typeof account.id === 'string' &&
        typeof account.address === 'string'
      ) {
        return account as unknown as StellarWalletAccount;
      }
    }
    return null;
  }

  private async attachSecureIframe(privy: PrivyClientLike): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('Privy headless requer um ambiente browser');
    }

    const iframe = document.createElement('iframe');
    iframe.src = privy.embeddedWallet.getURL();
    iframe.title = 'Privy secure wallet';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.display = 'none';
    const iframeOrigin = new URL(iframe.src).origin;
    const onMessage = (event: MessageEvent): void => {
      if (event.origin === iframeOrigin && event.source === iframe.contentWindow) {
        privy.embeddedWallet.onMessage(event.data);
      }
    };
    window.addEventListener('message', onMessage);
    (document.body ?? document.documentElement).appendChild(iframe);

    await new Promise<void>((resolve, reject) => {
      iframe.addEventListener('load', () => resolve(), { once: true });
      iframe.addEventListener('error', () => reject(new Error('Falha ao carregar secure iframe Privy')), {
        once: true,
      });
    });
    if (!iframe.contentWindow) throw new Error('Secure iframe Privy sem contentWindow');

    privy.setMessagePoster({
      postMessage: (message, targetOrigin, transfer) =>
        iframe.contentWindow!.postMessage(message, targetOrigin, transfer ? [transfer] : []),
      reload: () => iframe.contentWindow?.location.reload(),
    });
    const ready = await privy.embeddedWallet.ping(10_000);
    if (!ready) throw new Error('Secure iframe Privy não respondeu');
  }
}
