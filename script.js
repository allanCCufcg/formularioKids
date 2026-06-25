/* ═══════════════════════════════════════════════════════════════════
   I CORRIDA DE SANTA ANA — script.js
   Estratégia CORS: fire-and-forget via <form>+<iframe> oculto.
   O GAS não suporta CORS em fetch() de origens externas — ponto final.
   Solução: enviar dados via submit de formulário HTML (sem fetch),
   o browser não bloqueia isso. Número de inscrição e valor são
   gerados localmente; o GAS apenas persiste na planilha.
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════════════════════
   ⚙️  CONFIGURAÇÕES — edite aqui
   ══════════════════════════════════════════════════════════════════ */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzsznL8dnuiH92e7r3euEx8V-PaORjQOGtHS8InsyBBbtrWzwYZaCy0Y5gqGF-JMX-G/exec';

//pra ver se vai

const PIX_KEY      = '(83) 98200-4834';              // Chave PIX (CPF, e-mail, telefone ou aleatória)
const PIX_RECEIVER = 'Allan de Albuquerque Monteiro - PICPAY'; // Nome do beneficiário (max 25 chars)
const PIX_CITY     = 'ALAGOA NOVA';

/* Valores calculados localmente (espelho do servidor) */
const VALORES = {
  'Sem camisa': 35,
};

/* ══════════════════════════════════════════════════════════════════
   ESTADO GLOBAL
   ══════════════════════════════════════════════════════════════════ */
const state = {
  categoria:       '',
  percurso:        '',
  tipoInscricao:   '',
  valor:           0,
  numeroInscricao: '',
  pixPayload:      '',
};

/* ══════════════════════════════════════════════════════════════════
   UTILITÁRIOS
   ══════════════════════════════════════════════════════════════════ */

function calcularIdade(dataNascStr) {
  const hoje = new Date();
  const nasc = new Date(dataNascStr + 'T00:00:00');
  let idade  = hoje.getFullYear() - nasc.getFullYear();
  const m    = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

function resolverCategoria(idade) {
  if (idade >= 0  && idade <= 7)  return { categoria: '6 a 7 anos',   percurso: '50 metros'  };
  if (idade >= 8  && idade <= 10) return { categoria: '8 a 10 anos',  percurso: '100 metros' };
  if (idade >= 11 && idade <= 13) return { categoria: '11 a 13 anos', percurso: '150 metros' };
  return null;
}

function mascaraTelefone(valor) {
  return valor
    .replace(/\D/g, '')
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2')
    .slice(0, 15);
}

function formatarMoeda(valor) {
  return 'R$ ' + valor.toFixed(2).replace('.', ',');
}

/** Gera número de inscrição local baseado em timestamp + random */
function gerarNumeroInscricaoLocal() {
  const now = Date.now();
  const seq = (now % 9000) + 1000; // 4 dígitos pseudo-únicos
  return 'CSA-' + String(seq).padStart(4, '0');
}

function abrirModal(id)  { document.getElementById(id).classList.add('open');    }
function fecharModal(id) { document.getElementById(id).classList.remove('open'); }

function mostrarErro(fieldId, msg) {
  const el    = document.getElementById(fieldId + 'Error');
  const input = document.getElementById(fieldId);
  if (el)    el.textContent = msg;
  if (input) input.classList.add('error');
}

function limparErro(fieldId) {
  const el    = document.getElementById(fieldId + 'Error');
  const input = document.getElementById(fieldId);
  if (el)    el.textContent = '';
  if (input) input.classList.remove('error');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader  = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

/* ══════════════════════════════════════════════════════════════════
   ENVIO VIA FORM + IFRAME (fire-and-forget — sem CORS)
   Técnica: cria um <form> apontando para um <iframe> oculto e faz
   submit. O browser envia a requisição sem restrição de CORS porque
   é uma navegação de formulário, não XHR/fetch. Não lemos a resposta
   (cross-origin), mas o GAS processa e salva normalmente.
   ══════════════════════════════════════════════════════════════════ */
function enviarViaForm(params, onDone) {
  const iframeId = 'gasFrame_' + Date.now();

  const iframe    = document.createElement('iframe');
  iframe.name     = iframeId;
  iframe.id       = iframeId;
  iframe.style.cssText = 'display:none;width:0;height:0;border:none;';
  document.body.appendChild(iframe);

  const form    = document.createElement('form');
  form.method   = 'POST';
  form.action   = APPS_SCRIPT_URL;
  form.target   = iframeId;
  form.style.display = 'none';
  form.enctype  = 'application/x-www-form-urlencoded';

  Object.entries(params).forEach(([key, val]) => {
    const input   = document.createElement('input');
    input.type    = 'hidden';
    input.name    = key;
    input.value   = val;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();

  /* Aguarda load do iframe ou timeout de 10s — o que vier primeiro */
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    try { document.body.removeChild(form);   } catch (_) {}
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch (_) {}
    }, 500);
    if (onDone) onDone();
  };

  iframe.addEventListener('load', cleanup);
  setTimeout(cleanup, 10000);
}

/* ══════════════════════════════════════════════════════════════════
   GERAÇÃO DO PAYLOAD PIX (EMV / BR Code)
   ══════════════════════════════════════════════════════════════════ */
function gerarPixPayload(chave, beneficiario, cidade, txid, valor) {
  function campo(id, v) {
    return id + String(v.length).padStart(2, '0') + v;
  }
  const merchant = campo('00', 'BR.GOV.BCB.PIX') + campo('01', chave);
  const valorStr = valor > 0 ? valor.toFixed(2) : '';
  const txidLimpo = (txid || 'CORRIDASANTAANA').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';

  let payload =
    campo('00', '01') +
    campo('26', merchant) +
    campo('52', '0000') +
    campo('53', '986') +
    (valorStr ? campo('54', valorStr) : '') +
    campo('58', 'BR') +
    campo('59', (beneficiario || 'BENEFICIARIO').slice(0, 25).toUpperCase()) +
    campo('60', (cidade || 'BRASIL').slice(0, 15).toUpperCase()) +
    campo('62', campo('05', txidLimpo));

  payload += campo('63', crc16(payload + '6304'));
  return payload;
}

function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

/* ══════════════════════════════════════════════════════════════════
   QR CODE
   ══════════════════════════════════════════════════════════════════ */
async function renderizarQRCode(payload) {
  const canvas = document.getElementById('qrcodeCanvas');
  const img    = document.getElementById('qrcodeImage');
  canvas.style.display = 'block';
  img.style.display    = 'none';

  try {
    await QRCode.toCanvas(canvas, payload, {
      width:  220,
      margin: 2,
      color: { dark: '#0D1B2A', light: '#FFFFFF' },
    });
  } catch (e) {
    console.error('QR Code error:', e);
    try {
      const dataUrl = await QRCode.toDataURL(payload, {
        width:  220,
        margin: 2,
        color: { dark: '#0D1B2A', light: '#FFFFFF' },
      });
      canvas.style.display = 'none';
      img.src             = dataUrl;
      img.style.display   = 'block';
    } catch (err) {
      console.error('QR Code fallback error:', err);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   RESUMO
   ══════════════════════════════════════════════════════════════════ */
function atualizarResumo() {
  const resumoCard = document.getElementById('resumoCard');
  if (!state.categoria && !state.tipoInscricao) {
    resumoCard.style.display = 'none';
    return;
  }
  resumoCard.style.display = 'block';
  document.getElementById('resumoCategoria').textContent = state.categoria || '—';
  document.getElementById('resumoPercurso').textContent  = state.percurso  || '—';
  document.getElementById('resumoTipo').textContent      = state.tipoInscricao || '—';
  document.getElementById('resumoValor').textContent     = state.valor > 0 ? formatarMoeda(state.valor) : 'R$ —';
}

/* ══════════════════════════════════════════════════════════════════
   VALIDAÇÃO
   ══════════════════════════════════════════════════════════════════ */
function validarFormulario() {
  let valido = true;

  const nomeCrianca = document.getElementById('nomeCrianca').value.trim();
  limparErro('nomeCrianca');
  if (!nomeCrianca) { mostrarErro('nomeCrianca', 'Informe o nome completo da criança.'); valido = false; }

  const dataNasc = document.getElementById('dataNascimento').value;
  limparErro('dataNascimento');
  if (!dataNasc) {
    mostrarErro('dataNascimento', 'Informe a data de nascimento.'); valido = false;
  } else if (!state.categoria) {
    mostrarErro('dataNascimento', 'Idade fora da faixa permitida (até 13 anos).'); valido = false;
  }

  const sexo = document.getElementById('sexo').value;
  limparErro('sexo');
  if (!sexo) { mostrarErro('sexo', 'Selecione o sexo.'); valido = false; }

  const nomeResp = document.getElementById('nomeResponsavel').value.trim();
  limparErro('nomeResponsavel');
  if (!nomeResp) { mostrarErro('nomeResponsavel', 'Informe o nome do responsável.'); valido = false; }

  const whatsapp = document.getElementById('whatsapp').value.trim();
  limparErro('whatsapp');
  if (!whatsapp) {
    mostrarErro('whatsapp', 'Informe o WhatsApp do responsável.'); valido = false;
  } else if (whatsapp.replace(/\D/g, '').length < 10) {
    mostrarErro('whatsapp', 'Número de WhatsApp inválido.'); valido = false;
  }

  const email = document.getElementById('email').value.trim();
  limparErro('email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    mostrarErro('email', 'E-mail inválido.'); valido = false;
  }

  const tipoSel = document.querySelector('input[name="tipoInscricao"]:checked');
  limparErro('tipoInscricao');
  if (!tipoSel) { mostrarErro('tipoInscricao', 'Selecione o tipo de inscrição.'); valido = false; }

  const autorizacao = document.getElementById('autorizacao').checked;
  limparErro('autorizacao');
  if (!autorizacao) { mostrarErro('autorizacao', 'Você precisa autorizar a participação da criança.'); valido = false; }

  return valido;
}

/* ══════════════════════════════════════════════════════════════════
   ENVIO DA INSCRIÇÃO
   Estratégia: valida localmente → mostra PIX imediatamente →
   envia dados ao GAS em background (fire-and-forget via form+iframe).
   ══════════════════════════════════════════════════════════════════ */
async function enviarInscricao(e) {
  e.preventDefault();

  if (!validarFormulario()) {
    const primeiroErro = document.querySelector('.field-input.error, .field-error:not(:empty)');
    if (primeiroErro) primeiroErro.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btnText    = document.querySelector('.btn-text');
  const btnIcon    = document.querySelector('.btn-icon');
  const btnLoading = document.querySelector('.btn-loading');
  const btnSubmit  = document.getElementById('btnSubmit');

  btnText.style.display    = 'none';
  btnIcon.style.display    = 'none';
  btnLoading.style.display = 'flex';
  btnSubmit.disabled       = true;

  try {
    /* ── 1. Calcula tudo localmente ── */
    state.numeroInscricao = gerarNumeroInscricaoLocal();
    state.valor           = VALORES[state.tipoInscricao] || 0;

    const dataNasc = document.getElementById('dataNascimento').value;
    const idade    = calcularIdade(dataNasc);

    const params = {
      acao:            'inscricao',
      nomeCrianca:     document.getElementById('nomeCrianca').value.trim(),
      dataNascimento:  dataNasc,
      idade:           String(idade),
      sexo:            document.getElementById('sexo').value,
      categoria:       state.categoria,
      percurso:        state.percurso,
      nomeResponsavel: document.getElementById('nomeResponsavel').value.trim(),
      whatsapp:        document.getElementById('whatsapp').value.trim(),
      email:           document.getElementById('email').value.trim(),
      tipoInscricao:   state.tipoInscricao,
      valor:           String(state.valor),
      numeroInscricao: state.numeroInscricao,
    };

    /* ── 2. Envia ao GAS em background (sem esperar resposta) ── */
    enviarViaForm(params);

    /* ── 3. Exibe PIX imediatamente ── */
    state.pixPayload = gerarPixPayload(
      PIX_KEY, PIX_RECEIVER, PIX_CITY,
      state.numeroInscricao, state.valor
    );

    document.getElementById('pixNumeroInscricao').textContent = state.numeroInscricao;
    document.getElementById('pixValor').textContent           = formatarMoeda(state.valor);
    document.getElementById('pixCopiaCola').textContent       = state.pixPayload;
    document.getElementById('pixChaveInfo').textContent       = PIX_KEY      || 'Não configurada';
    document.getElementById('pixBeneficiario').textContent    = PIX_RECEIVER || 'Não configurado';

    await renderizarQRCode(state.pixPayload);

    document.getElementById('formSection').style.display  = 'none';
    document.getElementById('pixSection').style.display   = 'block';
    document.getElementById('infoSection').style.display  = 'none';
    atualizarProgressBar(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    console.error('Erro ao processar inscrição:', err);
    document.getElementById('modalErroDesc').textContent =
      'Ocorreu um erro inesperado. Tente novamente.';
    abrirModal('modalErro');
  } finally {
    btnText.style.display    = 'inline';
    btnIcon.style.display    = 'flex';
    btnLoading.style.display = 'none';
    btnSubmit.disabled       = false;
  }
}

/* ══════════════════════════════════════════════════════════════════
   ENVIO DO COMPROVANTE (também fire-and-forget)
   ══════════════════════════════════════════════════════════════════ */
async function enviarComprovante() {
  const fileInput = document.getElementById('comprovanteFile');
  const arquivo   = fileInput.files[0];
  if (!arquivo) return;

  const btn = document.getElementById('btnEnviarComprovante');
  btn.disabled    = true;
  btn.textContent = 'Enviando...';

  try {
    const base64 = await fileToBase64(arquivo);

    enviarViaForm({
      acao:            'comprovante',
      numeroInscricao: state.numeroInscricao,
      nomeArquivo:     arquivo.name,
      tipoArquivo:     arquivo.type,
      base64:          base64,
    }, () => {
      // Callback após load/timeout do iframe
    });

    /* Feedback imediato — não esperamos confirmação do GAS */
    document.getElementById('comprovanteCard').style.opacity       = '.5';
    document.getElementById('comprovanteCard').style.pointerEvents = 'none';
    mostrarConfirmacaoFinal();

  } catch (err) {
    console.error('Erro ao preparar comprovante:', err);
    document.getElementById('modalErroDesc').textContent =
      'Erro ao enviar o comprovante: ' + (err.message || 'Tente novamente.');
    abrirModal('modalErro');
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
      Enviar comprovante`;
  }
}

/* ══════════════════════════════════════════════════════════════════
   COPIAR PIX
   ══════════════════════════════════════════════════════════════════ */
async function mostrarConfirmacaoFinal() {
  document.getElementById('pixSection').style.display = 'none';
  document.getElementById('confirmSection').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function voltarParaInicio() {
  window.location.reload();
}

async function copiarPix() {
  const btn = document.getElementById('btnCopiarPix');
  try {
    await navigator.clipboard.writeText(state.pixPayload);
  } catch {
    const el = document.createElement('textarea');
    el.value = state.pixPayload;
    el.style.position = 'fixed';
    el.style.opacity  = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
  btn.classList.add('copied');
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg> Copiado!`;
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg> Copiar`;
  }, 3000);
}

/* ══════════════════════════════════════════════════════════════════
   PROGRESS BAR
   ══════════════════════════════════════════════════════════════════ */
function atualizarProgressBar(etapa) {
  document.getElementById('progressBarWrap').style.display = 'block';
  document.querySelectorAll('.progress-step').forEach((el, idx) => {
    const num = idx + 1;
    el.classList.remove('active', 'done');
    if (num < etapa)        el.classList.add('done');
    else if (num === etapa) el.classList.add('active');
  });
  document.querySelectorAll('.progress-connector').forEach((el, idx) => {
    el.classList.toggle('done', idx + 1 < etapa);
  });
}

/* ══════════════════════════════════════════════════════════════════
   UPLOAD: DRAG & DROP + CLICK
   ══════════════════════════════════════════════════════════════════ */
function inicializarUpload() {
  const uploadArea    = document.getElementById('uploadArea');
  const fileInput     = document.getElementById('comprovanteFile');
  const uploadContent = document.getElementById('uploadContent');
  const uploadPreview = document.getElementById('uploadPreview');
  const uploadBtn     = document.getElementById('uploadBtn');
  const uploadRemove  = document.getElementById('uploadRemove');
  const uploadName    = document.getElementById('uploadFileName');
  const btnEnviar     = document.getElementById('btnEnviarComprovante');

  const tiposPermitidos = ['image/jpeg', 'image/png', 'application/pdf'];

  function selecionarArquivo(file) {
    if (!tiposPermitidos.includes(file.type)) {
      alert('Tipo não permitido. Use JPG, PNG ou PDF.'); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Arquivo muito grande. Máximo: 10 MB.'); return;
    }
    const dt    = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;

    uploadName.textContent      = file.name;
    uploadContent.style.display = 'none';
    uploadPreview.style.display = 'flex';
    uploadArea.classList.add('has-file');
    btnEnviar.disabled = false;
  }

  uploadBtn.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('click', (e) => { if (e.target === uploadArea) fileInput.click(); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) selecionarArquivo(fileInput.files[0]); });

  uploadRemove.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.value             = '';
    uploadContent.style.display = 'block';
    uploadPreview.style.display = 'none';
    uploadArea.classList.remove('has-file');
    btnEnviar.disabled = true;
  });

  uploadArea.addEventListener('dragover',  (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', ()  => { uploadArea.classList.remove('drag-over'); });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) selecionarArquivo(e.dataTransfer.files[0]);
  });
}

/* ══════════════════════════════════════════════════════════════════
   INICIALIZAÇÃO
   ══════════════════════════════════════════════════════════════════ */
function inicializar() {

  /* Data de nascimento → categoria automática */
  document.getElementById('dataNascimento').addEventListener('change', function () {
    const wrap = document.getElementById('categoriaBadgeWrap');
    limparErro('dataNascimento');
    if (!this.value) {
      wrap.style.display = 'none';
      state.categoria = ''; state.percurso = '';
      atualizarResumo(); return;
    }
    const idade = calcularIdade(this.value);
    const res   = resolverCategoria(idade);
    if (res) {
      state.categoria = res.categoria;
      state.percurso  = res.percurso;
      document.getElementById('categoriaText').textContent = res.categoria;
      document.getElementById('percursoText').textContent  = res.percurso;
      wrap.style.display = 'block';
      const aviso = document.getElementById('avisoMenorSeis');
      aviso.style.display = idade < 6 ? 'block' : 'none';
    } else {
      state.categoria = ''; state.percurso = '';
      wrap.style.display = 'none';
      document.getElementById('avisoMenorSeis').style.display = 'none';
      mostrarErro('dataNascimento', 'Fora da faixa permitida. Categoria Kids: até 13 anos.');
    }
    atualizarResumo();
    atualizarProgressBar(1);
  });

  /* Tipo de inscrição */
  document.querySelectorAll('input[name="tipoInscricao"]').forEach(radio => {
    radio.addEventListener('change', function () {
      limparErro('tipoInscricao');
      state.tipoInscricao = this.value;
      state.valor = VALORES[this.value];
      atualizarResumo();
      atualizarProgressBar(2);
    });
  });

  /* Máscara WhatsApp */
  document.getElementById('whatsapp').addEventListener('input', function () {
    this.value = mascaraTelefone(this.value);
    limparErro('whatsapp');
  });

  /* Limpa erros ao digitar */
  ['nomeCrianca', 'nomeResponsavel', 'email', 'sexo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', () => limparErro(id)); el.addEventListener('change', () => limparErro(id)); }
  });

  /* Submit */
  document.getElementById('inscricaoForm').addEventListener('submit', enviarInscricao);

  /* PIX: copiar */
  document.getElementById('btnCopiarPix').addEventListener('click', copiarPix);

  /* Comprovante: enviar */
  document.getElementById('btnEnviarComprovante').addEventListener('click', enviarComprovante);

  /* Modais */
  document.getElementById('btnFecharErro').addEventListener('click', () => fecharModal('modalErro'));
  document.getElementById('btnFecharComprovanteOk').addEventListener('click', () => fecharModal('modalComprovanteOk'));
  document.getElementById('btnVoltarInicio').addEventListener('click', voltarParaInicio);
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', (e) => { if (e.target === o) o.classList.remove('open'); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  });

  /* Upload */
  inicializarUpload();
}

document.addEventListener('DOMContentLoaded', inicializar);