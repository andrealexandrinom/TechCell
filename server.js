const express = require('express');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const SECRET = process.env.SECRET || 'techcell-segredo-didatico';
const db = new DatabaseSync(path.join(__dirname, 'techcell.db'));
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS usuario (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL, perfil TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cliente (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT NOT NULL, cep TEXT, endereco TEXT);
CREATE TABLE IF NOT EXISTS aparelho (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES cliente(id), tipo TEXT NOT NULL, marca TEXT NOT NULL, modelo TEXT NOT NULL, imei TEXT);
CREATE TABLE IF NOT EXISTS ordem_servico (id INTEGER PRIMARY KEY AUTOINCREMENT, aparelho_id INTEGER NOT NULL REFERENCES aparelho(id), tecnico_id INTEGER REFERENCES usuario(id), defeito TEXT NOT NULL, estado_entrada TEXT, status TEXT NOT NULL, aprovado INTEGER, aprovado_em TEXT, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS item_os (id INTEGER PRIMARY KEY, os_id INTEGER NOT NULL REFERENCES ordem_servico(id), tipo TEXT NOT NULL, descricao TEXT NOT NULL, quantidade INTEGER NOT NULL, valor REAL NOT NULL);
CREATE TABLE IF NOT EXISTS historico_status (id INTEGER PRIMARY KEY, os_id INTEGER NOT NULL REFERENCES ordem_servico(id), status TEXT NOT NULL, observacao TEXT, usuario TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_os_status ON ordem_servico(status);
CREATE INDEX IF NOT EXISTS idx_cli_tel ON cliente(telefone);
`);

const STATUS = ['Recebido', 'Em diagnóstico', 'Aguardando aprovação', 'Em reparo', 'Pronto para retirada', 'Entregue', 'Devolvido ao cliente'];
const FINAIS = ['Entregue', 'Devolvido ao cliente'];
const now = () => new Date().toISOString();

// ---------- senha e token ----------
function hash(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex');
}
function confere(senha, h) {
  const [salt, k] = h.split(':');
  return crypto.timingSafeEqual(Buffer.from(k, 'hex'), crypto.scryptSync(senha, salt, 32));
}
function criaToken(u) {
  const p = Buffer.from(JSON.stringify({ id: u.id, nome: u.nome, perfil: u.perfil, exp: Date.now() + 8 * 3600e3 })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
}
function leToken(t) {
  const [p, s] = (t || '').split('.');
  if (!p || !s) return null;
  const esperado = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (s.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(esperado))) return null;
  const d = JSON.parse(Buffer.from(p, 'base64url').toString());
  return d.exp > Date.now() ? d : null;
}

// usuários de demonstração
if (!db.prepare('SELECT 1 FROM usuario').get()) {
  const ins = db.prepare('INSERT INTO usuario (nome,email,senha,perfil) VALUES (?,?,?,?)');
  ins.run('Proprietário', 'admin@techcell.com', hash('admin123'), 'Administrador');
  ins.run('Atendente Ana', 'atendente@techcell.com', hash('atend123'), 'Atendente');
  ins.run('Técnico Bruno', 'tecnico@techcell.com', hash('tec123'), 'Técnico');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const auth = (...perfis) => (req, res, next) => {
  const u = leToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!u) return res.status(401).json({ erro: 'Sessão inválida. Faça login novamente.' });
  if (perfis.length && u.perfil !== 'Administrador' && !perfis.includes(u.perfil))
    return res.status(403).json({ erro: 'Seu perfil não tem permissão para esta ação.' });
  req.user = u; next();
};
const digitos = s => String(s || '').replace(/\D/g, '');

function registraHistorico(osId, status, obs, usuario) {
  db.prepare('INSERT INTO historico_status (os_id,status,observacao,usuario,data) VALUES (?,?,?,?,?)').run(osId, status, obs || '', usuario, now());
}

// ---------- API ----------
app.post('/api/auth/login', (req, res) => {
  const { email, senha } = req.body;
  const u = db.prepare('SELECT * FROM usuario WHERE email=?').get(email || '');
  if (!u || !confere(senha || '', u.senha)) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  res.json({ token: criaToken(u), nome: u.nome, perfil: u.perfil });
});

app.get('/api/clientes', auth('Atendente'), (req, res) => {
  const q = `%${req.query.q || ''}%`;
  res.json(db.prepare('SELECT * FROM cliente WHERE nome LIKE ? OR telefone LIKE ? ORDER BY nome').all(q, q));
});
app.post('/api/clientes', auth('Atendente'), (req, res) => {
  const { nome, telefone, cep, endereco } = req.body;
  if (!nome || nome.trim().length < 3) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
  const tel = digitos(telefone);
  if (tel.length < 10 || tel.length > 11) return res.status(400).json({ erro: 'Informe um telefone válido, com DDD.' });
  const r = db.prepare('INSERT INTO cliente (nome,telefone,cep,endereco) VALUES (?,?,?,?)').run(nome.trim(), tel, digitos(cep), endereco || '');
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
app.post('/api/aparelhos', auth('Atendente'), (req, res) => {
  const { cliente_id, tipo, marca, modelo, imei } = req.body;
  if (!tipo || !marca || !modelo) return res.status(400).json({ erro: 'Preencha tipo, marca e modelo.' });
  if (imei && /^\d+$/.test(imei) && imei.length !== 15) return res.status(400).json({ erro: 'O IMEI deve ter 15 dígitos.' });
  const r = db.prepare('INSERT INTO aparelho (cliente_id,tipo,marca,modelo,imei) VALUES (?,?,?,?,?)').run(cliente_id, tipo, marca, modelo, imei || '');
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

const OS_SQL = `SELECT o.*, c.nome cliente, c.telefone, a.tipo, a.marca, a.modelo, a.imei,
  (SELECT COALESCE(SUM(quantidade*valor),0) FROM item_os WHERE os_id=o.id) total
  FROM ordem_servico o JOIN aparelho a ON a.id=o.aparelho_id JOIN cliente c ON c.id=a.cliente_id`;

app.get('/api/os', auth(), (req, res) => {
  const { status, q, de, ate } = req.query;
  let sql = OS_SQL + ' WHERE 1=1', p = [];
  if (status) { sql += ' AND o.status=?'; p.push(status); }
  if (q) { sql += ' AND (CAST(o.id AS TEXT)=? OR c.nome LIKE ? OR a.modelo LIKE ? OR a.marca LIKE ?)'; p.push(q, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (de) { sql += ' AND o.criado_em>=?'; p.push(de); }
  if (ate) { sql += ' AND o.criado_em<=?'; p.push(ate + 'T23:59:59'); }
  res.json(db.prepare(sql + ' ORDER BY o.id DESC').all(...p));
});

// Abre OS já criando cliente/aparelho quando necessário (fluxo da tela "Nova OS")
app.post('/api/os', auth('Atendente'), (req, res) => {
  const { cliente, aparelho, defeito, estado_entrada } = req.body;
  if (!defeito || defeito.trim().length < 10) return res.status(400).json({ erro: 'Descreva o defeito com mais detalhes.' });
  if (!cliente || !cliente.nome || cliente.nome.trim().length < 3) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
  const tel = digitos(cliente.telefone);
  if (tel.length < 10 || tel.length > 11) return res.status(400).json({ erro: 'Informe um telefone válido, com DDD.' });
  if (!aparelho || !aparelho.tipo || !aparelho.marca || !aparelho.modelo) return res.status(400).json({ erro: 'Preencha tipo, marca e modelo.' });
  if (aparelho.imei && /^\d+$/.test(aparelho.imei) && aparelho.imei.length !== 15) return res.status(400).json({ erro: 'O IMEI deve ter 15 dígitos.' });
  let id;
  db.exec('BEGIN');
  try {
    const cli = db.prepare('SELECT id FROM cliente WHERE telefone=? AND nome=?').get(tel, cliente.nome.trim());
    const cid = cli ? cli.id : Number(db.prepare('INSERT INTO cliente (nome,telefone,cep,endereco) VALUES (?,?,?,?)').run(cliente.nome.trim(), tel, digitos(cliente.cep), cliente.endereco || '').lastInsertRowid);
    const aid = Number(db.prepare('INSERT INTO aparelho (cliente_id,tipo,marca,modelo,imei) VALUES (?,?,?,?,?)').run(cid, aparelho.tipo, aparelho.marca, aparelho.modelo, aparelho.imei || '').lastInsertRowid);
    id = Number(db.prepare('INSERT INTO ordem_servico (aparelho_id,defeito,estado_entrada,status,criado_em) VALUES (?,?,?,?,?)').run(aid, defeito.trim(), estado_entrada || '', 'Recebido', now()).lastInsertRowid);
    registraHistorico(id, 'Recebido', 'OS aberta', req.user.nome);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ erro: 'Erro ao salvar a OS.' }); }
  res.status(201).json({ id });
});

function detalhe(id) {
  const os = db.prepare(OS_SQL + ' WHERE o.id=?').get(id);
  if (!os) return null;
  os.itens = db.prepare('SELECT * FROM item_os WHERE os_id=?').all(id);
  os.historico = db.prepare('SELECT * FROM historico_status WHERE os_id=? ORDER BY id').all(id);
  return os;
}
app.get('/api/os/:id', auth(), (req, res) => {
  const os = detalhe(req.params.id);
  os ? res.json(os) : res.status(404).json({ erro: 'OS não encontrada.' });
});

app.post('/api/os/:id/itens', auth('Técnico'), (req, res) => {
  const os = db.prepare('SELECT * FROM ordem_servico WHERE id=?').get(req.params.id);
  if (!os) return res.status(404).json({ erro: 'OS não encontrada.' });
  if (FINAIS.includes(os.status)) return res.status(400).json({ erro: 'OS finalizada: somente leitura.' });
  const { tipo, descricao, quantidade, valor } = req.body;
  if (!descricao || !(valor >= 0) || !(quantidade > 0)) return res.status(400).json({ erro: 'Preencha descrição, quantidade e valor.' });
  db.prepare('INSERT INTO item_os (os_id,tipo,descricao,quantidade,valor) VALUES (?,?,?,?,?)').run(os.id, tipo === 'Peça' ? 'Peça' : 'Serviço', descricao, quantidade, valor);
  res.status(201).json(detalhe(os.id));
});

// RF07: aprovação / recusa do orçamento
app.post('/api/os/:id/aprovacao', auth('Atendente'), (req, res) => {
  const os = db.prepare('SELECT * FROM ordem_servico WHERE id=?').get(req.params.id);
  if (!os) return res.status(404).json({ erro: 'OS não encontrada.' });
  if (FINAIS.includes(os.status)) return res.status(400).json({ erro: 'OS finalizada: somente leitura.' });
  const aprovado = req.body.aprovado ? 1 : 0;
  db.prepare('UPDATE ordem_servico SET aprovado=?, aprovado_em=? WHERE id=?').run(aprovado, now(), os.id);
  registraHistorico(os.id, os.status, aprovado ? 'Orçamento aprovado pelo cliente' : 'Orçamento recusado pelo cliente', req.user.nome);
  res.json(detalhe(os.id));
});

app.patch('/api/os/:id/status', auth('Atendente', 'Técnico'), (req, res) => {
  const os = db.prepare('SELECT * FROM ordem_servico WHERE id=?').get(req.params.id);
  if (!os) return res.status(404).json({ erro: 'OS não encontrada.' });
  const { status, observacao } = req.body;
  if (!STATUS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  if (FINAIS.includes(os.status)) return res.status(400).json({ erro: 'OS finalizada: somente leitura.' });
  if (status === 'Em reparo' && os.aprovado !== 1) return res.status(400).json({ erro: 'Registre a aprovação do orçamento antes de iniciar o reparo.' });
  db.prepare('UPDATE ordem_servico SET status=? WHERE id=?').run(status, os.id);
  registraHistorico(os.id, status, observacao, req.user.nome);
  res.json(detalhe(os.id));
});

// RF13: relatório
app.get('/api/relatorio', auth(), (req, res) => {
  if (req.user.perfil !== 'Administrador') return res.status(403).json({ erro: 'Somente o administrador acessa relatórios.' });
  const { de, ate } = req.query;
  res.json(db.prepare('SELECT status, COUNT(*) qtd FROM ordem_servico WHERE criado_em>=? AND criado_em<=? GROUP BY status')
    .all(de || '0000', (ate || '9999-12-31') + 'T23:59:59'));
});

// RF11: consulta pública (sem dados pessoais)
app.get('/api/publico/os', (req, res) => {
  const tel = digitos(req.query.telefone);
  const os = detalhe(Number(req.query.protocolo));
  if (!os || os.telefone !== tel) return res.status(404).json({ erro: 'Não encontramos uma ordem com esses dados.' });
  res.json({
    protocolo: os.id, status: os.status, aparelho: `${os.marca} ${os.modelo}`, total: os.total,
    itens: os.itens.map(i => ({ descricao: i.descricao, quantidade: i.quantidade, valor: i.valor })),
    historico: os.historico.map(h => ({ status: h.status, data: h.data }))
  });
});

app.get('/api/status', (req, res) => res.json(STATUS));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TechCell OS rodando em http://localhost:${PORT}`));
