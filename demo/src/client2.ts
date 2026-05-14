/**
 * client2.ts — Lógica de cadastro do Vesta Seguros
 *
 * Demonstra o fluxo completo de NOVO usuário:
 *   1. Usuário preenche formulário
 *   2. SDK verifica se existe VC no dispositivo
 *   3. Se não existir → exibe modal de KYC animado
 *   4. SDK emite credencial via API + registra Passkey no dispositivo
 *   5. Tela de sucesso com badge "Nova credencial criada"
 *
 * Se o usuário já tiver uma VC (segunda visita), o KYC é pulado e a
 * credencial é validada on-chain diretamente.
 */

import type { SmartEnrollResult } from '@hous3-digital/vesta-sdk';
import { createSDK } from './sdk-config';

// ─── Instância do SDK ──────────────────────────────────────────────────────
const sdk = createSDK('vesta_seguros');

// ─── Referências ao DOM ────────────────────────────────────────────────────
const form            = document.getElementById('enroll-form')     as HTMLFormElement;
const submitBtn       = document.getElementById('submit-btn')      as HTMLButtonElement;
const btnLabel        = document.getElementById('btn-label')       as HTMLSpanElement;
const vcFoundBanner   = document.getElementById('vc-found-banner') as HTMLDivElement;
const errorBanner     = document.getElementById('error-banner')    as HTMLDivElement;
const errorMessage    = document.getElementById('error-message')   as HTMLSpanElement;

// Form fields
const fullNameInput   = document.getElementById('fullName')        as HTMLInputElement;
const cpfInput        = document.getElementById('cpf')             as HTMLInputElement;
const birthDateInput  = document.getElementById('birthDate')       as HTMLInputElement;

// Success screen
const formCard        = document.getElementById('form-card')       as HTMLDivElement;
const successScreen   = document.getElementById('success-screen')  as HTMLDivElement;
const successTitle    = document.getElementById('success-title')   as HTMLHeadingElement;
const successSubtitle = document.getElementById('success-subtitle')as HTMLParagraphElement;
const vcHashDisplay   = document.getElementById('vc-hash-display') as HTMLSpanElement;
const userTypeBadge   = document.getElementById('user-type-badge') as HTMLSpanElement;
const txRow           = document.getElementById('tx-row')          as HTMLDivElement;
const txHashDisplay   = document.getElementById('tx-hash-display') as HTMLSpanElement;
const mockRow         = document.getElementById('mock-row')        as HTMLDivElement;

// KYC Modal
const kycModal        = document.getElementById('kyc-modal')       as HTMLDivElement;
const progressFill    = document.getElementById('progress-fill')   as HTMLDivElement;
const step1           = document.getElementById('step-1')          as HTMLDivElement;
const step2           = document.getElementById('step-2')          as HTMLDivElement;
const step3           = document.getElementById('step-3')          as HTMLDivElement;
const dot1            = document.getElementById('dot-1')           as HTMLDivElement;
const dot2            = document.getElementById('dot-2')           as HTMLDivElement;
const dot3            = document.getElementById('dot-3')           as HTMLDivElement;

// ─── Helpers de formatação ────────────────────────────────────────────────

/**
 * Aplica máscara de CPF no input (000.000.000-00).
 */
function maskCpf(value: string): string {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    .slice(0, 14);
}

/**
 * Remove formatação do CPF, retornando apenas dígitos.
 */
function cleanCpf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Converte data do formato de input HTML (YYYY-MM-DD) para YYYYMMDD
 * conforme esperado pelo circuito ZK como private input.
 */
function cleanBirthDate(value: string): string {
  return value.replace(/-/g, '');
}

/**
 * Normaliza nome completo para maiúsculas sem acentos,
 * conforme esperado pelo circuito ZK como private input.
 */
function normalizeFullName(value: string): string {
  return value
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove acentos
    .replace(/\s+/g, ' ');           // colapsa espaços duplos
}

// ─── Helpers de UI ────────────────────────────────────────────────────────

/** Aguarda N milissegundos. */
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Ativa um step do modal (spinner animado). */
function setStepActive(step: HTMLDivElement, dot: HTMLDivElement): void {
  step.classList.add('active');
  step.classList.remove('done');
  dot.textContent = '';
}

/** Marca um step como concluído (check verde). */
function setStepDone(step: HTMLDivElement, dot: HTMLDivElement): void {
  step.classList.remove('active');
  step.classList.add('done');
  dot.textContent = '✓';
}

/** Exibe o modal de KYC e inicia animação dos steps. */
function showKycModal(): void {
  kycModal.classList.remove('hidden');
  progressFill.style.width = '0%';

  // Step 1 imediatamente
  setStepActive(step1, dot1);
  progressFill.style.width = '15%';

  // Step 2 após 1.2s
  setTimeout(() => {
    setStepDone(step1, dot1);
    setStepActive(step2, dot2);
    progressFill.style.width = '50%';
  }, 1200);

  // Step 3 após 2.5s
  setTimeout(() => {
    setStepDone(step2, dot2);
    setStepActive(step3, dot3);
    progressFill.style.width = '80%';
  }, 2500);
}

/** Finaliza animação do modal e o fecha. */
async function hideKycModal(): Promise<void> {
  setStepDone(step3, dot3);
  progressFill.style.width = '100%';
  await sleep(400);
  kycModal.classList.add('hidden');
}

/** Exibe a mensagem de erro no banner. */
function showError(message: string): void {
  errorMessage.textContent = message;
  errorBanner.classList.remove('hidden');
  submitBtn.disabled = false;
  btnLabel.textContent = 'Criar conta com Passkey';
}

/** Oculta o banner de erro. */
function hideError(): void {
  errorBanner.classList.add('hidden');
}

/** Exibe a tela de sucesso com os dados do resultado. */
function showSuccess(result: SmartEnrollResult): void {
  formCard.style.display = 'none';
  successScreen.classList.add('visible');

  vcHashDisplay.textContent = `${result.vcHash.slice(0, 8)}...${result.vcHash.slice(-8)}`;

  if (result.isNewUser) {
    successTitle.textContent   = 'Conta criada com sucesso!';
    successSubtitle.textContent = 'Sua identidade foi verificada e protegida por Passkey.';
    userTypeBadge.className    = 'badge badge-new';
    userTypeBadge.textContent  = '🆕 Nova credencial criada';
  } else {
    successTitle.textContent   = 'Identidade verificada on-chain!';
    successSubtitle.textContent = 'Sua credencial Vesta existente foi validada na Stellar Testnet.';
    userTypeBadge.className    = 'badge badge-green';
    userTypeBadge.textContent  = '♻️ Credencial portada';

    if (result.txHash) {
      txRow.style.display    = 'flex';
      txHashDisplay.textContent = `${result.txHash.slice(0, 12)}...`;
    }
  }

  if (result.mock) {
    mockRow.style.display = 'flex';
  }
}

// ─── Inicialização ────────────────────────────────────────────────────────

/**
 * Ao carregar a página, verifica se já existe uma VC no dispositivo
 * para exibir o banner informativo antes do envio do formulário.
 */
async function init(): Promise<void> {
  if (!sdk.isPasskeySupported()) {
    showError('Este browser não suporta Passkeys. Use Chrome, Safari ou Edge atualizado.');
    submitBtn.disabled = true;
    return;
  }

  try {
    const hasVC = await sdk.hasStoredCredential();
    if (hasVC) {
      vcFoundBanner.classList.remove('hidden');
    }
  } catch {
    // Silencia erros de verificação inicial — IndexedDB pode estar vazio
  }
}

// ─── Máscara de CPF ───────────────────────────────────────────────────────
cpfInput.addEventListener('input', () => {
  cpfInput.value = maskCpf(cpfInput.value);
});

// ─── Submit do formulário ─────────────────────────────────────────────────
form.addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  hideError();

  // Validação básica dos campos
  const fullName = fullNameInput.value.trim();
  const cpf      = cleanCpf(cpfInput.value);
  const birthDate = birthDateInput.value;

  if (!fullName) { showError('Informe seu nome completo.'); return; }
  if (cpf.length !== 11) { showError('CPF inválido. Informe os 11 dígitos.'); return; }
  if (!birthDate) { showError('Informe sua data de nascimento.'); return; }

  // Estado de loading
  submitBtn.disabled = true;
  btnLabel.textContent = 'Aguarde...';

  // Verificar novamente se há VC (pode ter mudado desde o load)
  let hasVC = false;
  try {
    hasVC = await sdk.hasStoredCredential();
  } catch { /* segue sem VC */ }

  // Exibir modal de KYC somente para novos usuários
  if (!hasVC) {
    showKycModal();
  }

  try {
    const result = await sdk.smartEnroll({
      userData: {
        cpf,
        fullName,
        birthDate,
        kycLevel:  'complete',
        kycMethod: 'document_verification',
      },
      privateInputs: {
        cpf,
        birthDate:  cleanBirthDate(birthDate),
        fullName:   normalizeFullName(fullName),
      },
      verifierId:  'verifier_vesta_seguros',
      minKycLevel: 2,
    });

    if (!hasVC) {
      await hideKycModal();
    }

    showSuccess(result);
  } catch (err) {
    if (!hasVC) {
      kycModal.classList.add('hidden');
    }

    const message = err instanceof Error ? err.message : 'Erro desconhecido.';
    showError(message);
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────
init();
