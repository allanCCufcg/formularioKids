/* ═══════════════════════════════════════════════════════════════════
   I CORRIDA DE SANTA ANA — Code.gs  (Google Apps Script)
   ═══════════════════════════════════════════════════════════════════

   DEPLOY:
   1. script.google.com → novo projeto → cole este código
   2. Implantar → Nova implantação → Tipo: "App da Web"
   3. Executar como: "Eu" | Acesso: "Qualquer pessoa"
   4. Cole a URL gerada em script.js (APPS_SCRIPT_URL)
   5. Execute inicializarPlanilha() uma vez para criar as abas

   CORS: o frontend envia dados via <form>+<iframe> (sem fetch).
   doPost() recebe e.parameter com os campos do formulário.
   doGet() serve como ping/healthcheck.
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ── CONFIGURAÇÕES ── */
var CONFIG = {
  SHEET_NAME:        'INSCRIÇÕES',
  DASHBOARD_NAME:    'DASHBOARD',
  DRIVE_FOLDER_NAME: 'COMPROVANTES_CORRIDA_SANTA_ANA',
  SPREADSHEET_ID:    '1eUuplc3YiYHnbCE6r9bVfHNOP3C7S2eU6PUeh9o3UXk', // vazio = usa planilha ativa
};

/* ── VALORES (fonte de verdade secundária — o frontend já calculou) ── */
var VALORES_VALIDOS = { 'Sem camisa': 35, 'Com camisa': 55 };

/* ── CORES ── */
var COR = {
  headerBg:   '#0D1B2A', headerFg:  '#FFFFFF',
  pendente:   '#FEF9C3', enviado:   '#DBEAFE',
  confirmado: '#DCFCE7', cancelado: '#FEE2E2',
  dashBg:     '#1E3A5F', dashBlue:  '#2563EB', dashGreen: '#16A34A',
  row1:       '#F8FAFC', row2:      '#EFF6FF',
};

function doGet(e) {
  return json({ status: 'online', message: 'I Corrida de Santa Ana — API ok.' });
}

function doPost(e) {
  try {
    var p    = (e && e.parameter) ? e.parameter : {};
    var acao = String(p.acao || '').trim();

    if (acao === 'inscricao')   return json(processarInscricao(p));
    if (acao === 'comprovante') return json(processarComprovante(p));

    return json({ success: false, message: 'Ação desconhecida: ' + acao });
  } catch (err) {
    return json({ success: false, message: 'Erro interno: ' + err.message });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function processarInscricao(p) {
  var obrig = ['nomeCrianca','dataNascimento','sexo','nomeResponsavel','whatsapp','tipoInscricao'];
  for (var i = 0; i < obrig.length; i++) {
    if (!p[obrig[i]] || !String(p[obrig[i]]).trim()) {
      return { success: false, message: 'Campo ausente: ' + obrig[i] };
    }
  }

  var tipo = String(p.tipoInscricao || '').trim();
  if (!VALORES_VALIDOS.hasOwnProperty(tipo)) {
    return { success: false, message: 'Tipo de inscrição inválido.' };
  }

  var valor = VALORES_VALIDOS[tipo];

  var tamanhosValidos = {
    '2 anos':      '2 anos',
    '4 anos':      '4 anos',
    '6 anos':      '6 anos',
    '8 anos':      '8 anos',
    '10 anos':     '10 anos',
    '12 anos':     '12 anos',
    'adulto pp':   'Adulto PP',
    'adulto p':    'Adulto P',
    'adulto m':    'Adulto M',
    'adulto g':    'Adulto G',
    'adulto gg':   'Adulto GG'
  };

  var tamanho = '';
  if (tipo === 'Com camisa') {
    var raw = String(p.tamanhoCamisa || '').trim();
    if (!raw) {
      return { success: false, message: 'Tamanho de camisa inválido.' };
    }
    var key = raw.toLowerCase();
    if (!tamanhosValidos.hasOwnProperty(key)) {
      return { success: false, message: 'Tamanho de camisa inválido.' };
    }
    tamanho = tamanhosValidos[key];
  }

  var dataNasc = new Date(String(p.dataNascimento || '').trim() + 'T00:00:00');
  if (isNaN(dataNasc.getTime())) {
    return { success: false, message: 'Data de nascimento inválida.' };
  }

  var hoje  = new Date();
  var idade = hoje.getFullYear() - dataNasc.getFullYear();
  var mm    = hoje.getMonth() - dataNasc.getMonth();
  if (mm < 0 || (mm === 0 && hoje.getDate() < dataNasc.getDate())) idade--;

  var cat = resolverCategoria(idade);
  if (!cat) return { success: false, message: 'Idade fora da faixa (6-13 anos): ' + idade };

  var ss    = getSheet();
  var sheet = getAbaInscricoes(ss);

  var numeroFrontend = String(p.numeroInscricao || '').trim();
  var numero = (numeroFrontend && /^CSA-\d{4}$/.test(numeroFrontend))
    ? numeroFrontend
    : gerarNumero(sheet);

  var agora = new Date();
  var linha = [
    Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
    numero,
    String(p.nomeCrianca || '').trim(),
    Utilities.formatDate(dataNasc, Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    idade,
    String(p.sexo || '').trim(),
    cat.categoria,
    cat.percurso,
    tipo,
    tamanho,
    valor,
    String(p.nomeResponsavel || '').trim(),
    String(p.whatsapp || '').trim(),
    String(p.email || '').trim(),
    'Pendente Pagamento',
    '',
    ''
  ];

  var row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, linha.length).setValues([linha]);
  aplicarCorStatus(sheet, row, 'Pendente Pagamento');
  sheet.getRange(row, 11).setNumberFormat('R$ #,##0.00');

  try { atualizarDashboard(ss); } catch (_) {}

  return { success: true, numeroInscricao: numero, valor: valor };
}

function processarComprovante(p) {
  if (!p.numeroInscricao || !p.base64 || !p.nomeArquivo) {
    return { success: false, message: 'Dados incompletos.' };
  }

  var pasta   = getPastaComprovantes();
  var blob    = Utilities.newBlob(
    Utilities.base64Decode(String(p.base64 || '')),
    String(p.tipoArquivo || 'application/octet-stream'),
    String(p.numeroInscricao || 'comprovante') + '_' + String(p.nomeArquivo || 'arquivo')
  );
  var arquivo = pasta.createFile(blob);
  arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var link = arquivo.getUrl();

  var ss    = getSheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return { success: false, message: 'Aba não encontrada.' };

  var dados = sheet.getDataRange().getValues();
  var found = -1;
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][1]) === String(p.numeroInscricao)) { found = i + 1; break; }
  }
  if (found === -1) return { success: false, message: 'Inscrição não encontrada.' };

  sheet.getRange(found, 15).setValue('Pagamento Enviado');
  sheet.getRange(found, 16).setValue(link);
  aplicarCorStatus(sheet, found, 'Pagamento Enviado');

  try { atualizarDashboard(ss); } catch (_) {}

  return { success: true, link: link };
}

function getSheet() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function getAbaInscricoes(ss) {
  var s = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!s) { s = ss.insertSheet(CONFIG.SHEET_NAME); configurarAba(s); }
  return s;
}

function configurarAba(sheet) {
  var cab = ['Data/Hora','Nº Inscrição','Nome da Criança','Data de Nascimento','Idade',
             'Sexo','Categoria','Percurso','Tipo de Inscrição','Tamanho Camisa','Valor (R$)',
             'Nome do Responsável','WhatsApp','E-mail','Status','Link Comprovante','Observações'];

  sheet.getRange(1,1,1,cab.length).setValues([cab]);

  var h = sheet.getRange(1,1,1,cab.length);
  h.setBackground(COR.headerBg).setFontColor(COR.headerFg)
   .setFontWeight('bold').setFontSize(11)
   .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,cab.length).createFilter();

  var larg = [140,120,220,130,60,80,110,90,130,120,100,200,130,200,150,250,200];
  larg.forEach(function(l,i){ sheet.setColumnWidth(i+1, l); });

  var valStatus = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pendente Pagamento','Pagamento Enviado','Confirmado','Cancelado'], true)
    .setAllowInvalid(false).build();
  sheet.getRange('O2:O1000').setDataValidation(valStatus);

  [2,5,6,7,8,9,10,11,15].forEach(function(c){
    sheet.getRange(2,c,999,1).setHorizontalAlignment('center');
  });
  sheet.getRange('K2:K1000').setNumberFormat('R$ #,##0.00');
}

function gerarNumero(sheet) {
  var seq = Math.max(sheet.getLastRow(), 1);
  return 'CSA-' + String(seq).padStart(4,'0');
}

function aplicarCorStatus(sheet, row, status) {
  var mapa = {
    'Pendente Pagamento': COR.pendente,
    'Pagamento Enviado':  COR.enviado,
    'Confirmado':         COR.confirmado,
    'Cancelado':          COR.cancelado,
  };
  if (mapa[status]) sheet.getRange(row, 15).setBackground(mapa[status]);
}

function getPastaComprovantes() {
  var it = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);
}

function resolverCategoria(idade) {
  if (idade >= 6  && idade <= 7)  return { categoria: '6 a 7 anos',   percurso: '50 metros'  };
  if (idade >= 8  && idade <= 10) return { categoria: '8 a 10 anos',  percurso: '100 metros' };
  if (idade >= 11 && idade <= 13) return { categoria: '11 a 13 anos', percurso: '150 metros' };
  return null;
}

function onEdit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  if (e.range.getColumn() === 15 && e.range.getRow() > 1) {
    aplicarCorStatus(sheet, e.range.getRow(), e.value);
    try { atualizarDashboard(sheet.getParent()); } catch(_) {}
  }
}

function atualizarDashboard(ss) {
  var src = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!src) return;

  var dash = ss.getSheetByName(CONFIG.DASHBOARD_NAME);
  if (!dash) { dash = ss.insertSheet(CONFIG.DASHBOARD_NAME); ss.setActiveSheet(dash); ss.moveActiveSheet(1); }
  dash.clear(); dash.clearFormats();

  var rows = src.getDataRange().getValues().slice(1).filter(function(r){ return r[1]; });

  var total    = rows.length;
  var comCam   = rows.filter(function(r){ return r[8]==='Com camisa'; }).length;
  var semCam   = rows.filter(function(r){ return r[8]==='Sem camisa'; }).length;
  var conf     = rows.filter(function(r){ return r[14]==='Confirmado'; }).length;
  var pend     = rows.filter(function(r){ return r[14]==='Pendente Pagamento'; }).length;
  var enviad   = rows.filter(function(r){ return r[14]==='Pagamento Enviado'; }).length;
  var canc     = rows.filter(function(r){ return r[14]==='Cancelado'; }).length;
  var valPrev  = rows.reduce(function(a,r){ return a+(Number(r[10])||0); }, 0);
  var valConf  = rows.filter(function(r){ return r[14]==='Confirmado'; })
                     .reduce(function(a,r){ return a+(Number(r[10])||0); }, 0);
  var cat67    = rows.filter(function(r){ return r[6]==='6 a 7 anos'; }).length;
  var cat810   = rows.filter(function(r){ return r[6]==='8 a 10 anos'; }).length;
  var cat1113  = rows.filter(function(r){ return r[6]==='11 a 13 anos'; }).length;

  var tam = {};
  rows.forEach(function(r){ if(r[9]) tam[r[9]]=(tam[r[9]]||0)+1; });
  var ordemTam = [
    '2 anos',
    '4 anos',
    '6 anos',
    '8 anos',
    '10 anos',
    '12 anos',
    'Adulto PP',
    'Adulto P',
    'Adulto M',
    'Adulto G',
    'Adulto GG'
  ];

  function titulo(range, bg, fg, sz, bold) {
    range.setBackground(bg).setFontColor(fg).setFontSize(sz||13)
         .setFontWeight(bold?'bold':'normal').setHorizontalAlignment('center').setVerticalAlignment('middle');
  }
  function subtit(range) {
    range.setBackground(COR.dashBg).setFontColor(COR.headerFg)
         .setFontSize(10).setFontWeight('bold').setHorizontalAlignment('left').setVerticalAlignment('middle');
    dash.setRowHeight(range.getRow(), 26);
  }
  function linha(row, label, val, fmt) {
    dash.getRange(row,1).setValue(label).setFontSize(11);
    var c = dash.getRange(row,2);
    c.setValue(val).setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center');
    if (fmt) c.setNumberFormat(fmt);
    dash.getRange(row,1,1,2).setBackground((row%2===0)?COR.row2:COR.row1);
    dash.setRowHeight(row, 28);
  }

  dash.getRange('A1:B1').merge(); dash.getRange('A1').setValue('🏃 I CORRIDA DE SANTA ANA — DASHBOARD');
  titulo(dash.getRange('A1'), COR.headerBg, COR.headerFg, 15, true); dash.setRowHeight(1,50);
  dash.getRange('A2:B2').merge(); dash.getRange('A2').setValue('Painel — Categoria Kids');
  titulo(dash.getRange('A2'), COR.dashBlue, COR.headerFg, 11, false); dash.setRowHeight(2,28);

  dash.getRange('A3:B3').merge(); dash.getRange('A3').setValue('INDICADORES GERAIS'); subtit(dash.getRange('A3'));
  [
    ['👤 Total de Inscritos', total],
    ['👕 Com Camisa', comCam],
    ['🏃 Sem Camisa', semCam],
    ['✅ Confirmados', conf],
    ['⏳ Pendentes', pend],
    ['📩 Pag. Enviado', enviad],
    ['❌ Cancelados', canc],
  ].forEach(function(d,i){ linha(4+i, d[0], d[1]); });

  var r1 = 12;
  dash.getRange('A'+r1+':B'+r1).merge(); dash.getRange('A'+r1).setValue('FINANCEIRO'); subtit(dash.getRange('A'+r1));
  linha(r1+1, '💰 Valor Previsto',   valPrev,  'R$ #,##0.00');
  linha(r1+2, '✅ Valor Confirmado', valConf,  'R$ #,##0.00');
  [r1+1,r1+2].forEach(function(rr){ dash.getRange(rr,2).setFontColor(COR.dashGreen); });

  var r2 = r1+4;
  dash.getRange('A'+r2+':B'+r2).merge(); dash.getRange('A'+r2).setValue('POR CATEGORIA'); subtit(dash.getRange('A'+r2));
  linha(r2+1,'🟢 6 a 7 anos (50m)',  cat67);
  linha(r2+2,'🟡 8 a 10 anos (100m)',cat810);
  linha(r2+3,'🔴 11 a 13 anos (150m)',cat1113);

  var r3 = r2+5;
  dash.getRange('A'+r3+':B'+r3).merge(); dash.getRange('A'+r3).setValue('POR TAMANHO DE CAMISA'); subtit(dash.getRange('A'+r3));
  ordemTam.forEach(function(t,i){ linha(r3+1+i,'👕 '+t, tam[t]||0); });

  var rAtu = r3+ordemTam.length+2;
  dash.getRange('A'+rAtu).setValue('Atualizado em: '+Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'dd/MM/yyyy HH:mm:ss'))
      .setFontSize(9).setFontColor('#9CA3AF').setFontStyle('italic');

  dash.setColumnWidth(1,260); dash.setColumnWidth(2,140);
}

function inicializarPlanilha() {
  var ss = getSheet();
  getAbaInscricoes(ss);
  atualizarDashboard(ss);
  SpreadsheetApp.getUi().alert('✅ Planilha configurada!\nAbas: ' + CONFIG.SHEET_NAME + ' e ' + CONFIG.DASHBOARD_NAME);
}
