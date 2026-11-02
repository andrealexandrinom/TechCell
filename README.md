# TechCell OS

Protótipo de sistema web para gestão de ordens de serviço (OS) de uma assistência técnica fictícia.
Trabalho de Estágio Supervisionado – Atividade Prática Profissional (Multivix Serra).

**Tecnologias:** HTML5, Bootstrap 5 (via CDN), JavaScript, Node.js + Express, SQLite (módulo nativo `node:sqlite`), API ViaCEP.

## Como executar (passo a passo)

1. **Instale o Node.js** versão **22.13 ou superior** (https://nodejs.org). Confira com:
   ```
   node -v
   ```
2. **Abra um terminal** na pasta do projeto (`TechCell`).
3. **Instale as dependências:**
   ```
   npm install
   ```
4. **Inicie o servidor:**
   ```
   npm start
   ```
   Deve aparecer: `TechCell OS rodando em http://localhost:3000`
5. **Abra no navegador:** http://localhost:3000
   (é necessária internet para carregar o Bootstrap e a busca de CEP).
6. O banco `techcell.db` é criado automaticamente na primeira execução, já com os usuários de demonstração.

Para parar o servidor, use `Ctrl + C` no terminal.

## Usuários de demonstração

| Perfil        | E-mail                | Senha    |
|---------------|-----------------------|----------|
| Administrador | admin@techcell.com    | admin123 |
| Atendente     | atendente@techcell.com| atend123 |
| Técnico       | tecnico@techcell.com  | tec123   |

## Roteiro sugerido para testar

1. Entre como **Atendente** → **+ Nova OS** → preencha cliente/aparelho/defeito (teste o botão *Buscar CEP*) → salve e imprima o comprovante.
2. Entre como **Técnico** → abra a OS → adicione itens ao orçamento → mude o status para *Aguardando aprovação*.
3. Como **Atendente** → *Enviar orçamento (WhatsApp)* → *Registrar aprovação*.
4. Como **Técnico** → status *Em reparo* (só é permitido após a aprovação) → *Pronto para retirada*.
5. Como **Atendente** → *Avisar cliente (WhatsApp)* → status *Entregue* (a OS fica somente leitura).
6. Abra a **Consulta cliente** (http://localhost:3000/consulta.html) e informe protocolo + telefone.
7. Como **Administrador** → menu **Relatório**.

## Estrutura

```
server.js          API REST, regras de negócio e banco SQLite
public/index.html  Sistema interno (login, painel, nova OS, detalhe, relatório)
public/consulta.html  Consulta pública do cliente
```

## Observações

- É um protótipo didático: o segredo do token está no código (`SECRET`) e não há HTTPS.
- Fora do escopo: notas fiscais, financeiro, pagamento online, estoque completo.
#
