/* ═══════════════════════════════════════════════════════════════════
   I CORRIDA DE SANTA ANA — script.js
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ── CONFIGURAÇÃO ──────────────────────────────────────────────────
   Substitua pela URL do seu Google Apps Script publicado.
   ─────────────────────────────────────────────────────────────────── */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxRkRWxOD0QeU6GHexXlpg1e4-wxvK-rHYvK2mSGQvI9LQ_Pvulf_8S-vTj3-hHmxiC/exec';

/* ─────────────────────────────────────────────────────────────────
   HELPER: requisição ao GAS sem bloqueio de CORS.
   O Google Apps Script redireciona POSTs externos, então usamos GET
   com os dados em query string + redirect:'follow'. Isso funciona
   de forma confiável em GitHub Pages / Netlify.
   ─────────────────────────────────────────────────────────────────── */
async function gasRequest(params) {
  const qs  = new URLSearchParams(params).toString();
  const url = APPS_SCRIPT_URL + '?' + qs;

  const res  = await fetch(url, { method: 'GET', redirect: 'follow' });
  const text = await res.text();

  // O GAS às vezes retorna HTML de erro em vez de JSON — protege o parse
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Resposta inesperada do servidor. Verifique o deploy do Apps Script.');
  }
}

/* ── PIX ────────────────────────────────────────────────────────────
   Preencha com os dados reais da chave PIX.
   ─────────────────────────────────────────────────────────────────── */
const PIX_KEY      = '83982004834';          // Chave PIX (CPF, CNPJ, e-mail, telefone ou aleatória)
const PIX_RECEIVER = 'Allan de Albuquerque Monteiro';          // Nome do beneficiário (max 25 chars)
const PIX_CITY     = 'ALAGOA NOVA';  // Cidade do beneficiário

/* ══════════════════════════════════════════════════════════════════
   ESTADO GLOBAL
   ══════════════════════════════════════════════════════════════════ */
const state = {
  categoria:       '',
  percurso:        '',
  tipoInscricao:   '',
  tamanhoCamisa:   '',
  valor:           0,
  numeroInscricao: '',
  pixPayload:      '',
};

/* ══════════════════════════════════════════════════════════════════
   UTILITÁRIOS
   ══════════════════════════════════════════════════════════════════ */

/** Calcula a idade em anos completos a partir de uma string 'YYYY-MM-DD'. */
function calcularIdade(dataNascStr) {
  const hoje  = new Date();
  const nasc  = new Date(dataNascStr + 'T00:00:00');
  let idade   = hoje.getFullYear() - nasc.getFullYear();
  const m     = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

/** Retorna { categoria, percurso } com base na idade. */
function resolverCategoria(idade) {
  if (idade >= 6  && idade <= 7)  return { categoria: '6 a 7 anos',   percurso: '50 metros'  };
  if (idade >= 8  && idade <= 10) return { categoria: '8 a 10 anos',  percurso: '100 metros' };
  if (idade >= 11 && idade <= 13) return { categoria: '11 a 13 anos', percurso: '150 metros' };
  return null;
}

/** Mascara o número de telefone: (XX) XXXXX-XXXX */
function mascaraTelefone(valor) {
  return valor
    .replace(/\D/g, '')
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2')
    .slice(0, 15);
}

/** Formata valor monetário: 35 → 'R$ 35,00' */
function formatarMoeda(valor) {
  return 'R$ ' + valor.toFixed(2).replace('.', ',');
}

/** Abre um modal pelo ID. */
function abrirModal(id) {
  document.getElementById(id).classList.add('open');
}

/** Fecha um modal pelo ID. */
function fecharModal(id) {
  document.getElementById(id).classList.remove('open');
}

/** Mostra mensagem de erro em um campo. */
function mostrarErro(fieldId, msg) {
  const el = document.getElementById(fieldId + 'Error');
  const input = document.getElementById(fieldId);
  if (el)    el.textContent = msg;
  if (input) input.classList.add('error');
}

/** Limpa mensagem de erro de um campo. */
function limparErro(fieldId) {
  const el = document.getElementById(fieldId + 'Error');
  const input = document.getElementById(fieldId);
  if (el)    el.textContent = '';
  if (input) input.classList.remove('error');
}

/** Converte um arquivo em Base64. */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

/* ══════════════════════════════════════════════════════════════════
   GERAÇÃO DO PAYLOAD PIX (EMV / BR Code)
   Spec: BCB Manual de Padrões para Iniciação do Pix
   ══════════════════════════════════════════════════════════════════ */
function gerarPixPayload(chave, beneficiario, cidade, txid, valor) {
  /** Formata um campo TLV (tag, comprimento, valor). */
  function campo(id, valor) {
    const tam = String(valor.length).padStart(2, '0');
    return id + tam + valor;
  }

  const merchantAccountInfo = campo('00', 'BR.GOV.BCB.PIX') + campo('01', chave);
  const valorStr = valor > 0 ? valor.toFixed(2) : '';
  const txidLimpo = (txid || 'CORRIDASANTAANA').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';

  let payload =
    campo('00', '01') +                                         // Payload Format Indicator
    campo('26', merchantAccountInfo) +                          // Merchant Account Information
    campo('52', '0000') +                                       // Merchant Category Code
    campo('53', '986') +                                        // Transaction Currency (BRL)
    (valorStr ? campo('54', valorStr) : '') +                   // Transaction Amount
    campo('58', 'BR') +                                         // Country Code
    campo('59', beneficiario.slice(0, 25).toUpperCase()) +      // Merchant Name
    campo('60', cidade.slice(0, 15).toUpperCase()) +            // Merchant City
    campo('62', campo('05', txidLimpo));                        // Additional Data Field

  payload += campo('63', calcularCRC16(payload + '6304'));
  return payload;
}

/** Calcula CRC16-CCITT (0xFFFF) conforme spec PIX. */
function calcularCRC16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return ((crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'));
}

/* ══════════════════════════════════════════════════════════════════
   RENDERIZAR QR CODE
   ══════════════════════════════════════════════════════════════════ */
async function renderizarQRCode(payload) {
  try {
    await QRCode.toCanvas(document.getElementById('qrcodeCanvas'), payload, {
      width:            220,
      margin:           2,
      color: { dark: '#0D1B2A', light: '#FFFFFF' },
    });
  } catch (e) {
    console.error('Erro ao gerar QR Code:', e);
  }
}

/* ══════════════════════════════════════════════════════════════════
   ATUALIZAÇÃO DO RESUMO
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
   VALIDAÇÃO DO FORMULÁRIO
   ══════════════════════════════════════════════════════════════════ */
function validarFormulario() {
  let valido = true;

  // Nome da criança
  const nomeCrianca = document.getElementById('nomeCrianca').value.trim();
  limparErro('nomeCrianca');
  if (!nomeCrianca) {
    mostrarErro('nomeCrianca', 'Informe o nome completo da criança.');
    valido = false;
  }

  // Data de nascimento
  const dataNasc = document.getElementById('dataNascimento').value;
  limparErro('dataNascimento');
  if (!dataNasc) {
    mostrarErro('dataNascimento', 'Informe a data de nascimento.');
    valido = false;
  } else if (!state.categoria) {
    mostrarErro('dataNascimento', 'Idade fora da faixa permitida (6 a 13 anos).');
    valido = false;
  }

  // Sexo
  const sexo = document.getElementById('sexo').value;
  limparErro('sexo');
  if (!sexo) {
    mostrarErro('sexo', 'Selecione o sexo.');
    valido = false;
  }

  // Nome do responsável
  const nomeResp = document.getElementById('nomeResponsavel').value.trim();
  limparErro('nomeResponsavel');
  if (!nomeResp) {
    mostrarErro('nomeResponsavel', 'Informe o nome do responsável.');
    valido = false;
  }

  // WhatsApp
  const whatsapp = document.getElementById('whatsapp').value.trim();
  limparErro('whatsapp');
  const soDigitos = whatsapp.replace(/\D/g, '');
  if (!whatsapp) {
    mostrarErro('whatsapp', 'Informe o WhatsApp do responsável.');
    valido = false;
  } else if (soDigitos.length < 10) {
    mostrarErro('whatsapp', 'Número de WhatsApp inválido.');
    valido = false;
  }

  // E-mail (opcional, mas valida formato se preenchido)
  const email = document.getElementById('email').value.trim();
  limparErro('email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    mostrarErro('email', 'E-mail inválido.');
    valido = false;
  }

  // Tipo de inscrição
  const tipoSelecionado = document.querySelector('input[name="tipoInscricao"]:checked');
  limparErro('tipoInscricao');
  if (!tipoSelecionado) {
    mostrarErro('tipoInscricao', 'Selecione o tipo de inscrição.');
    valido = false;
  }

  // Tamanho da camisa (condicional)
  limparErro('tamanhoCamisa');
  if (state.tipoInscricao === 'Com camisa') {
    const tamanho = document.getElementById('tamanhoCamisa').value;
    if (!tamanho) {
      mostrarErro('tamanhoCamisa', 'Selecione o tamanho da camisa.');
      valido = false;
    }
  }

  // Autorização
  const autorizacao = document.getElementById('autorizacao').checked;
  limparErro('autorizacao');
  if (!autorizacao) {
    mostrarErro('autorizacao', 'Você precisa autorizar a participação da criança.');
    valido = false;
  }

  return valido;
}

/* ══════════════════════════════════════════════════════════════════
   ENVIO DO FORMULÁRIO
   ══════════════════════════════════════════════════════════════════ */
async function enviarInscricao(e) {
  e.preventDefault();

  if (!validarFormulario()) {
    // Scroll para o primeiro erro
    const primeiroErro = document.querySelector('.field-input.error, .field-error:not(:empty)');
    if (primeiroErro) primeiroErro.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Estado de carregamento
  const btnText    = document.querySelector('.btn-text');
  const btnIcon    = document.querySelector('.btn-icon');
  const btnLoading = document.querySelector('.btn-loading');
  const btnSubmit  = document.getElementById('btnSubmit');

  btnText.style.display    = 'none';
  btnIcon.style.display    = 'none';
  btnLoading.style.display = 'flex';
  btnSubmit.disabled       = true;

  // Monta payload — apenas dados brutos; VALOR calculado no servidor
  const payload = {
    acao:            'inscricao',
    nomeCrianca:     document.getElementById('nomeCrianca').value.trim(),
    dataNascimento:  document.getElementById('dataNascimento').value,
    sexo:            document.getElementById('sexo').value,
    nomeResponsavel: document.getElementById('nomeResponsavel').value.trim(),
    whatsapp:        document.getElementById('whatsapp').value.trim(),
    email:           document.getElementById('email').value.trim(),
    tipoInscricao:   state.tipoInscricao,
    tamanhoCamisa:   state.tipoInscricao === 'Com camisa'
                       ? document.getElementById('tamanhoCamisa').value
                       : '',
  };

  try {
    const data = await gasRequest(payload);

    if (data.success) {
      // Guarda dados retornados pelo servidor
      state.numeroInscricao = data.numeroInscricao;
      state.valor           = data.valor; // Valor validado pelo servidor

      // Gera payload PIX
      state.pixPayload = gerarPixPayload(
        PIX_KEY,
        PIX_RECEIVER,
        PIX_CITY,
        state.numeroInscricao,
        state.valor
      );

      // Popula seção PIX
      document.getElementById('pixNumeroInscricao').textContent = state.numeroInscricao;
      document.getElementById('pixValor').textContent           = formatarMoeda(state.valor);
      document.getElementById('pixCopiaCola').textContent       = state.pixPayload;
      document.getElementById('pixChaveInfo').textContent       = PIX_KEY      || 'Não configurada';
      document.getElementById('pixBeneficiario').textContent    = PIX_RECEIVER || 'Não configurado';

      // Renderiza QR Code
      await renderizarQRCode(state.pixPayload);

      // Alterna seções
      document.getElementById('formSection').style.display = 'none';
      document.getElementById('pixSection').style.display  = 'block';
      document.getElementById('infoSection').style.display = 'none';

      // Progress bar
      atualizarProgressBar(3);

      window.scrollTo({ top: 0, behavior: 'smooth' });

    } else {
      throw new Error(data.message || 'Erro desconhecido no servidor.');
    }

  } catch (err) {
    console.error('Erro ao enviar inscrição:', err);
    document.getElementById('modalErroDesc').textContent =
      err.message || 'Ocorreu um erro ao processar sua inscrição. Por favor, tente novamente.';
    abrirModal('modalErro');

  } finally {
    btnText.style.display    = 'inline';
    btnIcon.style.display    = 'flex';
    btnLoading.style.display = 'none';
    btnSubmit.disabled       = false;
  }
}

/* ══════════════════════════════════════════════════════════════════
   ENVIO DO COMPROVANTE
   Comprovante usa POST via form oculto + iframe para contornar CORS,
   pois o base64 pode ser grande demais para query string.
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

    // Usa um iframe oculto como alvo do form para evitar o bloqueio de CORS
    // O GAS aceita multipart/form-data nesse padrão
    await enviarViaFormIframe({
      acao:            'comprovante',
      numeroInscricao: state.numeroInscricao,
      nomeArquivo:     arquivo.name,
      tipoArquivo:     arquivo.type,
      base64:          base64,
    });

    abrirModal('modalComprovanteOk');
    document.getElementById('comprovanteCard').style.opacity      = '.5';
    document.getElementById('comprovanteCard').style.pointerEvents = 'none';

  } catch (err) {
    console.error('Erro ao enviar comprovante:', err);
    document.getElementById('modalErroDesc').textContent =
      'Erro ao enviar o comprovante: ' + (err.message || 'Tente novamente.');
    abrirModal('modalErro');
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
      Enviar comprovante`;
  }
}

/**
 * Envia dados via <form> + <iframe> oculto.
 * Essa técnica ignora o bloqueio de CORS porque não usa XHR/fetch —
 * o browser submete o form diretamente para o GAS.
 * Aguarda 8s (tempo suficiente para o GAS processar e salvar no Drive).
 */
function enviarViaFormIframe(params) {
  return new Promise((resolve, reject) => {
    // Cria iframe oculto
    const iframeId = 'gasIframe_' + Date.now();
    const iframe   = document.createElement('iframe');
    iframe.name    = iframeId;
    iframe.id      = iframeId;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    // Cria form oculto apontando para o iframe
    const form   = document.createElement('form');
    form.method  = 'POST';
    form.action  = APPS_SCRIPT_URL;
    form.target  = iframeId;
    form.style.display = 'none';

    // Adiciona os campos
    Object.entries(params).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type  = 'hidden';
      input.name  = key;
      input.value = value;
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();

    // Aguarda o GAS processar (sem acesso ao conteúdo do iframe por CORS,
    // então usamos timeout generoso como indicador de conclusão)
    const timeout = setTimeout(() => {
      cleanup();
      resolve(); // Considera sucesso após o timeout
    }, 8000);

    // Se o iframe carregar antes do timeout, tenta ler a resposta
    iframe.onload = () => {
      clearTimeout(timeout);
      cleanup();
      resolve();
    };

    iframe.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('Falha ao enviar comprovante. Tente novamente.'));
    };

    function cleanup() {
      try { document.body.removeChild(form);   } catch(e) {}
      try { document.body.removeChild(iframe); } catch(e) {}
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
   PROGRESS BAR
   ══════════════════════════════════════════════════════════════════ */
function atualizarProgressBar(etapa) {
  const wrap = document.getElementById('progressBarWrap');
  wrap.style.display = 'block';

  document.querySelectorAll('.progress-step').forEach((el, idx) => {
    const num = idx + 1;
    el.classList.remove('active', 'done');
    if (num < etapa)       el.classList.add('done');
    else if (num === etapa) el.classList.add('active');
  });

  document.querySelectorAll('.progress-connector').forEach((el, idx) => {
    el.classList.toggle('done', idx + 1 < etapa);
  });
}

/* ══════════════════════════════════════════════════════════════════
   COPIAR PIX
   ══════════════════════════════════════════════════════════════════ */
async function copiarPix() {
  const btn = document.getElementById('btnCopiarPix');
  try {
    await navigator.clipboard.writeText(state.pixPayload);
    btn.classList.add('copied');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Copiado!`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copiar`;
    }, 3000);
  } catch {
    // Fallback para navegadores sem clipboard API
    const el = document.createElement('textarea');
    el.value = state.pixPayload;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    btn.textContent = 'Copiado!';
    setTimeout(() => btn.textContent = 'Copiar', 3000);
  }
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

  function selecionarArquivo(file) {
    const tiposPermitidos = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!tiposPermitidos.includes(file.type)) {
      alert('Tipo de arquivo não permitido. Use JPG, PNG ou PDF.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Arquivo muito grande. O limite é 10 MB.');
      return;
    }
    // Simula o input file
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;

    uploadName.textContent      = file.name;
    uploadContent.style.display = 'none';
    uploadPreview.style.display = 'flex';
    uploadArea.classList.add('has-file');
    btnEnviar.disabled = false;
  }

  uploadBtn.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('click', (e) => {
    if (e.target === uploadArea) fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) selecionarArquivo(fileInput.files[0]);
  });

  uploadRemove.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.value             = '';
    uploadContent.style.display = 'block';
    uploadPreview.style.display = 'none';
    uploadArea.classList.remove('has-file');
    btnEnviar.disabled = true;
  });

  // Drag & Drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) selecionarArquivo(file);
  });
}

/* ══════════════════════════════════════════════════════════════════
   LISTENERS PRINCIPAIS
   ══════════════════════════════════════════════════════════════════ */
function inicializar() {

  /* ── DATA DE NASCIMENTO → Categoria automática ── */
  document.getElementById('dataNascimento').addEventListener('change', function () {
    const wrap = document.getElementById('categoriaBadgeWrap');
    limparErro('dataNascimento');

    if (!this.value) {
      wrap.style.display = 'none';
      state.categoria    = '';
      state.percurso     = '';
      atualizarResumo();
      return;
    }

    const idade = calcularIdade(this.value);
    const res   = resolverCategoria(idade);

    if (res) {
      state.categoria = res.categoria;
      state.percurso  = res.percurso;
      document.getElementById('categoriaText').textContent = res.categoria;
      document.getElementById('percursoText').textContent  = res.percurso;
      wrap.style.display = 'block';
    } else {
      state.categoria = '';
      state.percurso  = '';
      wrap.style.display = 'none';
      mostrarErro('dataNascimento', 'Idade fora da faixa permitida. A categoria Kids é para crianças de 6 a 13 anos.');
    }

    atualizarResumo();
    // Avança progress bar para etapa 1 (dados)
    atualizarProgressBar(1);
    document.getElementById('progressBarWrap').style.display = 'block';
  });

  /* ── TIPO DE INSCRIÇÃO ── */
  document.querySelectorAll('input[name="tipoInscricao"]').forEach(radio => {
    radio.addEventListener('change', function () {
      limparErro('tipoInscricao');
      state.tipoInscricao = this.value;

      const campoTamanho  = document.getElementById('campoTamanho');
      const tamanhoCamisa = document.getElementById('tamanhoCamisa');

      if (this.value === 'Com camisa') {
        campoTamanho.style.display  = 'block';
        tamanhoCamisa.required      = true;
        state.valor                 = 55;
      } else {
        campoTamanho.style.display  = 'none';
        tamanhoCamisa.required      = false;
        tamanhoCamisa.value         = '';
        state.tamanhoCamisa         = '';
        state.valor                 = 35;
      }

      atualizarResumo();
      atualizarProgressBar(2);
    });
  });

  /* ── TAMANHO DA CAMISA ── */
  document.getElementById('tamanhoCamisa').addEventListener('change', function () {
    limparErro('tamanhoCamisa');
    state.tamanhoCamisa = this.value;
  });

  /* ── MÁSCARA WHATSAPP ── */
  document.getElementById('whatsapp').addEventListener('input', function () {
    this.value = mascaraTelefone(this.value);
    limparErro('whatsapp');
  });

  /* ── LIMPA ERROS AO DIGITAR ── */
  ['nomeCrianca', 'nomeResponsavel', 'email', 'sexo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => limparErro(id));
    if (el) el.addEventListener('change', () => limparErro(id));
  });

  /* ── SUBMIT ── */
  document.getElementById('inscricaoForm').addEventListener('submit', enviarInscricao);

  /* ── PIX: COPIAR ── */
  document.getElementById('btnCopiarPix').addEventListener('click', copiarPix);

  /* ── COMPROVANTE: ENVIAR ── */
  document.getElementById('btnEnviarComprovante').addEventListener('click', enviarComprovante);

  /* ── MODAIS ── */
  document.getElementById('btnFecharErro').addEventListener('click', () => fecharModal('modalErro'));
  document.getElementById('btnFecharComprovanteOk').addEventListener('click', () => fecharModal('modalComprovanteOk'));

  // Fechar modal clicando no overlay
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Fechar modal com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
  });

  /* ── UPLOAD ── */
  inicializarUpload();
}

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', inicializar);