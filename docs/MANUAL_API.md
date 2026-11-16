# Manual do usuário — API REST

A API é uma interface HTTP para o Greencode. O Swagger em `/documentation` exibe os schemas ativos e permite enviar requisições. A raiz `/` não serve uma página inicial.

## Endereço e autenticação

Por padrão, a API fica em `http://localhost:3000`. Todas as rotas, exceto `GET /health`, `POST /auth/login` e o cadastro inicial em `POST /auth/credentials`, exigem o cabeçalho:

```http
Authorization: Bearer SEU_TOKEN
```

O login retorna um JWT Bearer válido por 30 minutos por padrão (`JWT_EXPIRES_IN` pode alterar o prazo). `POST /auth/logout` revoga o token usado e requer novo login. A API consulta o usuário ativo e seu papel atual no banco em cada chamada.

Papéis e escopo geral:

| Papel | Permissões principais |
| --- | --- |
| `ADMINISTRADOR` | Todas as rotas de negócio, credenciais e parâmetros globais |
| `OPERADOR_CADASTRO` | Leitura e manutenção de organizações e contratos |
| `GESTOR_ALMOXARIFADO` | Leitura e manutenção de lotes e equipamentos |
| `AUDITOR` | Leitura de organizações, lotes e equipamentos, rastreabilidade e relatórios |

O cadastro inicial sem token só funciona quando não há credenciais, e deve criar um `ADMINISTRADOR`. Depois disso, somente administrador pode criar outras contas.

## Formatos e respostas comuns

- Datas são strings ISO 8601, por exemplo `2026-10-24T12:00:00.000Z`.
- Os corpos JSON rejeitam propriedades não documentadas pela rota.
- `200`: consulta ou atualização com corpo; `201`: registro criado com representação JSON; `204`: operação concluída sem corpo.
- Erros da API usam `{ "error": "CODIGO", "message": "Descrição" }`: `400` dados inválidos, `401` autenticação ausente/inválida/expirada/revogada, `403` papel sem permissão, `404` recurso inexistente, `409` duplicidade/conflito e `500` erro interno sanitizado. O health check retorna `503` quando o banco está indisponível, com o formato específico documentado abaixo.
- Em geral, criações e alterações de dados de negócio recebem o usuário autenticado como responsável e registram evento de auditoria.

Exemplo de erro:

```json
{
  "error": "CONFLICT",
  "message": "Conflito de atualização. Recarregue os dados e tente novamente."
}
```

O formato detalhado da representação de cada rota está no OpenAPI servido em `/documentation/json`. Respostas de relatórios são texto (`text/plain`); as demais respostas com corpo são JSON.

## Saúde e documentação

| Método e rota | Acesso | O que faz e dados |
| --- | --- | --- |
| `GET /health` | Público | Consulta o banco. Retorna `200` com `{ status: "ok", database: "connected" }` ou `503` indisponível. |
| `GET /documentation` | Público | Interface Swagger para explorar e executar os endpoints. |
| `GET /documentation/json` | Público | Documento OpenAPI gerado pela API. |

## Autenticação e credenciais

| Método e rota | Acesso | O que faz e dados |
| --- | --- | --- |
| `POST /auth/login` | Público | Login. Corpo: `usuario`, `senha`. Retorna token, tipo, validade e dados públicos do usuário. |
| `POST /auth/logout` | Token válido | Revoga imediatamente o token apresentado. Sem corpo; retorna `204`. |
| `POST /auth/credentials` | Público somente no primeiro cadastro; depois, administrador | Cria usuário. Corpo: `usuario`, `senha`, `papel`, opcional `nomeExibicao`. Retorna `201` e dados públicos. |
| `GET /auth/credentials` | Administrador | Lista todas as credenciais sem hash ou salt. |
| `GET /auth/credentials/search?nome=...` | Administrador | Busca credenciais pelo nome de exibição ou login, parcialmente e sem diferenciar maiúsculas/minúsculas. Retorna uma lista. |
| `GET /auth/credentials/:id` | Administrador | Consulta por ID ou login. |
| `PATCH /auth/credentials/:id/name` | Administrador | Altera nome. Corpo: `nomeExibicao`. Retorna `204`. |
| `PATCH /auth/credentials/:id/role` | Administrador | Altera papel. Corpo: `papel`. Retorna `204`. Não permite remover o último administrador. |
| `PUT /auth/credentials/:id/password` | Administrador | Redefine a senha de outro usuário. Corpo: `senha`. Retorna `204`. |
| `DELETE /auth/credentials/:id` | Administrador | Desativa credencial. Retorna `204`; invalida os tokens por bloqueio da conta e preserva o registro histórico anonimizado. |
| `PUT /auth/password` | Usuário autenticado, exceto auditor | Altera a própria senha. Corpo: `senhaAtual`, `senhaNova`. Retorna `204` em sucesso. |

Exemplo de resposta de login:

```json
{
  "token": "JWT",
  "tokenType": "Bearer",
  "expiresIn": "30m",
  "usuario": {
    "id": "USUARIO-001",
    "usuario": "admin",
    "nomeExibicao": "Administrador",
    "papel": "ADMINISTRADOR"
  }
}
```

Exemplo de login e chamada autenticada em PowerShell:

```powershell
$login = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/auth/login" `
  -ContentType "application/json" `
  -Body (@{ usuario = "admin"; senha = "SUA_SENHA" } | ConvertTo-Json)

$headers = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/organizations" -Headers $headers
```

Exemplo de saída manual:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/auth/logout" -Headers $headers
$headers = $null
```

Exemplo de busca por nome de exibição ou login (a listagem completa permanece em `GET /auth/credentials`; a busca por ID/login em `/auth/credentials/:id` também continua disponível):

```http
GET /auth/credentials/search?nome=Maria%20Silva
Authorization: Bearer SEU_TOKEN
```

## Organizações e contratos

| Método e rota | Acesso | O que faz e dados |
| --- | --- | --- |
| `GET /organizations` | Administrador, operador de cadastro, auditor | Lista organizações. Queries opcionais: `incluirDesativadas` (booleano) e `nome` (trecho da razão social, sem diferenciar maiúsculas/minúsculas). |
| `POST /organizations` | Administrador, operador de cadastro | Cadastra organização. Corpo obrigatório: `id`, `razaoSocial`, `cnpj`, `inscricaoEstadual`, `enderecoCompleto`, `telefone`, `email`. Retorna `201`. |
| `GET /organizations/:id` | Administrador, operador de cadastro, auditor | Consulta organização pelo ID. |
| `PATCH /organizations/:id` | Administrador, operador de cadastro | Atualiza um ou mais campos: `razaoSocial`, `cnpj`, `inscricaoEstadual`, `enderecoCompleto`, `telefone`, `email`. Corpo deve conter ao menos um campo. |
| `DELETE /organizations/:id` | Administrador, operador de cadastro | Desativa organização. Corpo: `motivo`. Retorna `204`; preserva vínculos e histórico. |
| `GET /organizations/:id/contracts` | Administrador, operador de cadastro, auditor | Lista contratos da organização. |
| `GET /organizations/:id/contracts/:contratoId` | Administrador, operador de cadastro, auditor | Consulta um contrato específico, validando seu vínculo com a organização. |
| `POST /organizations/:id/contracts` | Administrador, operador de cadastro | Cadastra contrato. Corpo obrigatório: `id`, `dataAssinatura`, `dataVencimento`, `valorMensal`; opcionais: `clausulas` (lista de strings), `renovacaoAutomatica` (booleano). Retorna `201`. |
| `PATCH /organizations/:id/contracts/:contratoId` | Administrador, operador de cadastro | Atualiza `clausulas`, `valorMensal` e/ou `renovacaoAutomatica`. Corpo deve conter ao menos um campo. |
| `POST /organizations/:id/contracts/renew` | Administrador, operador de cadastro | Renova contrato vigente. Corpo: `novoVencimento`. |
| `POST /organizations/:id/contracts/:contratoId/cancel` | Administrador, operador de cadastro | Cancela contrato específico. Sem corpo; retorna `204`. |
| `POST /organizations/:id/contracts/close` | Administrador, operador de cadastro | Encerra contrato vigente da organização. Sem corpo; retorna `204`. |

Exemplo de cadastro:

```json
{
  "id": "ORG-001",
  "razaoSocial": "Empresa Exemplo Ltda",
  "cnpj": "12.345.678/0001-95",
  "inscricaoEstadual": "ISENTO",
  "enderecoCompleto": "Rua Exemplo, 100, São Paulo - SP",
  "telefone": "+55 11 4000-1234",
  "email": "contato@example.com"
}
```

O CNPJ é validado e não pode duplicar outro cadastro. `PATCH` não permite alterar o `id`.

Exemplo de busca por razão social: `GET /organizations?nome=Recicla`. O endpoint retorna uma lista; a consulta direta por ID continua em `GET /organizations/:id`.

### Exemplo completo de cadastro

Os exemplos abaixo usam `curl` e JSON, funcionando no terminal Linux/macOS e no Windows com `curl.exe`. Execute primeiro o cadastro inicial apenas em um banco sem credenciais; ele cria o administrador. Se já houver administrador, pule essa chamada e faça login com uma conta existente.

```sh
curl -i -X POST http://localhost:3000/auth/credentials \
  -H "Content-Type: application/json" \
  -d '{"usuario":"admin","senha":"TroqueEstaSenha123!","papel":"ADMINISTRADOR","nomeExibicao":"Administrador"}'
```

Faça login e copie o valor `token` da resposta:

```sh
curl -i -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"admin","senha":"TroqueEstaSenha123!"}'
```

Nas chamadas seguintes, substitua `COLE_SEU_TOKEN` pelo token retornado. Cadastre uma organização:

```sh
curl -i -X POST http://localhost:3000/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLE_SEU_TOKEN" \
  -d '{"id":"DEMO-ORG-001","razaoSocial":"Organização Demonstração Ltda","cnpj":"04.252.011/0001-10","inscricaoEstadual":"ISENTO","enderecoCompleto":"Rua Exemplo, 100, São Paulo - SP","telefone":"+55 11 4000-1234","email":"contato@example.com"}'
```

O CNPJ do exemplo é válido, mas precisa ainda não estar cadastrado no banco. Se já existir, use outro CNPJ válido e exclusivo e altere o identificador `DEMO-ORG-001` para um valor ainda não utilizado.

Cadastre um contrato para essa organização. A data de assinatura deve ser anterior à data de vencimento:

```sh
curl -i -X POST http://localhost:3000/organizations/DEMO-ORG-001/contracts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLE_SEU_TOKEN" \
  -d '{"id":"DEMO-CONTRATO-001","dataAssinatura":"2026-10-24T12:00:00.000Z","dataVencimento":"2027-10-24T12:00:00.000Z","valorMensal":1250,"clausulas":["Destinação ambientalmente adequada"],"renovacaoAutomatica":false}'
```

Por fim, cadastre um lote com um equipamento em uma única operação. `dataEntrada` deve ser hoje ou uma data dos últimos 90 dias; atualize-a para a data atual ao executar este exemplo:

```sh
curl -i -X POST http://localhost:3000/lots/with-equipment \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLE_SEU_TOKEN" \
  -d '{"id":"DEMO-LOTE-001","dataEntrada":"2026-10-24T12:00:00.000Z","organizacaoId":"DEMO-ORG-001","notaFiscal":"NF-DEMO-001","transportadora":"Transportadora Exemplo","observacoes":"Cadastro de demonstração","equipamentos":[{"id":"DEMO-EQUIP-001","codigoBarrasInterno":"DEMO-COD-001","tipo":"NOTEBOOK","marca":"Exemplo","modelo":"Notebook 14","anoFabricacao":2024,"estadoFisico":"BOM_ESTADO","pesoQuilogramas":2.1}]}'
```

Cada chamada bem-sucedida retorna `201 Created` e o JSON do registro criado. Os identificadores, o CNPJ e o código de barras precisam ser exclusivos no banco. Se repetir o roteiro, use novos valores. Para cadastrar sem contrato ou sem equipamento, consulte os campos descritos nas tabelas de endpoints acima.

## Lotes

| Método e rota | Acesso | O que faz e dados |
| --- | --- | --- |
| `GET /lots` | Administrador, gestor de almoxarifado, auditor | Lista lotes. Filtros opcionais: `organizacaoId`, `nomeOrganizacao` (trecho da razão social), `dataInicio`, `dataFim`, `status`, `incluirCancelados`. A busca por nome da organização não diferencia maiúsculas/minúsculas. |
| `POST /lots` | Administrador, gestor de almoxarifado | Cadastra lote. Corpo: `id`, `dataEntrada`, `organizacaoId`, `notaFiscal`, `transportadora`; opcional `observacoes`. Retorna `201`. A organização precisa existir e estar ativa. |
| `POST /lots/with-equipment` | Administrador, gestor de almoxarifado | Cria lote e equipamentos em uma transação. Aceita os campos de `POST /lots` e `equipamentos`, uma lista não vazia dos objetos de equipamento definidos abaixo. Retorna `201`. |
| `GET /lots/:id` | Administrador, gestor de almoxarifado, auditor | Consulta lote e seus dados relacionados. |
| `PATCH /lots/:id` | Administrador, gestor de almoxarifado | Atualiza `dataEntrada`, `notaFiscal`, `transportadora` e/ou `observacoes`. Corpo deve conter ao menos um campo. |
| `POST /lots/:id/triage` | Administrador, gestor de almoxarifado | Conclui triagem do lote e avança equipamentos conforme as regras do fluxo. Sem corpo; retorna `204`. |
| `POST /lots/:id/equipment` | Administrador, gestor de almoxarifado | Adiciona equipamento ao lote. Corpo: objeto de equipamento. Retorna `201`. |
| `DELETE /lots/:id` | Administrador, gestor de almoxarifado | Cancela lote. Corpo: `motivo`. Retorna `204`; preserva histórico. É necessário cancelar logicamente os equipamentos ativos do lote antes de cancelar o lote. |

Campos do objeto de equipamento: `id`, `codigoBarrasInterno`, `tipo`, `marca`, `modelo`, `anoFabricacao`, `estadoFisico`, `pesoQuilogramas`. Os tipos, estados e enumerações aceitos estão listados na seção [Enumerações](#enumerações).

`dataEntrada` deve ser uma data ISO válida dentro do intervalo aceito pelo sistema (até 90 dias antes e sem data futura). Na criação conjunta, lote e todos os equipamentos são salvos atomicamente.

## Equipamentos e rastreabilidade

| Método e rota | Acesso | O que faz e dados |
| --- | --- | --- |
| `GET /equipment` | Administrador, gestor de almoxarifado, auditor | Lista equipamentos. Filtros opcionais: `loteId`, `nome` (trecho da marca ou modelo, sem diferenciar maiúsculas/minúsculas), `status`, `estadoFisico` e `incluirCancelados`. Paginação: `pagina` (padrão 1) e `limite` (padrão 20, máximo 100). `ordenarPor` aceita `dataCadastro`, `marca`, `modelo` ou `statusRastreamento`; a ordenação é crescente. |
| `GET /equipment/:id` | Administrador, gestor de almoxarifado, auditor | Consulta por ID ou código de barras interno. |
| `GET /equipment/:id/tracking` | Administrador, gestor de almoxarifado, auditor | Retorna rastreabilidade, eventos e vínculos do equipamento. |
| `PATCH /equipment/:id` | Administrador, gestor de almoxarifado | Atualiza um ou mais campos de cadastro: `tipo`, `marca`, `modelo`, `anoFabricacao`, `pesoQuilogramas`. O corpo deve conter também a `version` atual retornada pela consulta; conflito de versão retorna `409`. |
| `PATCH /equipment/:id/status` | Administrador, gestor de almoxarifado | Altera status. Corpo: `status`. A transição precisa obedecer ao fluxo operacional. Retorna `204`. |
| `PATCH /equipment/:id/physical-state` | Administrador, gestor de almoxarifado | Altera estado físico. Corpo: `estadoFisico`; opcional `justificativa`. Retorna `204`. Alterações que indiquem piora relevante podem exigir justificativa. |
| `POST /equipment/:id/movements` | Administrador, gestor de almoxarifado | Registra movimentação física. Corpo: `destino`. Retorna `204`. |
| `POST /equipment/:id/movements/corrections` | Administrador, gestor de almoxarifado | Corrige o destino de uma movimentação sem apagar o evento original. Corpo: `movimentacaoId`, `destino`, `justificativa`. Retorna `204`. |
| `POST /equipment/:id/movements/reversals` | Administrador, gestor de almoxarifado | Estorna movimentação, mantendo o evento original. Corpo: `movimentacaoId`, `justificativa`. Retorna `204`. |
| `POST /equipment/:id/cancel` | Administrador, gestor de almoxarifado | Cancela logicamente o equipamento. Corpo: `motivo`. Retorna `204`; mantém o registro e histórico, ocultando-o das listagens padrão. |
| `DELETE /equipment/:id` | Administrador, gestor de almoxarifado | Exclui fisicamente o equipamento e suas movimentações e auditorias relacionadas. Corpo: `motivo` (obrigatório, não retido). Retorna `204`; se outro equipamento referenciar suas movimentações, retorna `409` sem excluir. |

O status percorre, de acordo com as operações, triagem, espera por desmontagem, desmontagem, destino final (`PECAS_REAPROVEITADAS`, `MATERIAL_RECICLAVEL` ou `DESCARTE_SEGURO`) e baixa definitiva. `BAIXA_DEFINITIVA` é o encerramento do fluxo operacional, não uma exclusão. `POST /equipment/:id/cancel` preserva o registro e seu histórico. Já `DELETE /equipment/:id` apaga fisicamente o registro, as movimentações e as auditorias do equipamento; não mantém evento de exclusão.

As relações com lotes e movimentações usam `onDelete: Restrict`. Para cumprir a exclusão física, a API remove primeiro as movimentações e suas referências internas dentro da mesma transação; se houver referência cruzada de outro equipamento, a operação é recusada para preservar a integridade.

`GET /equipment` retorna `{ dados, total, pagina, limite, totalPaginas }`. `dados` contém apenas os equipamentos da página solicitada; os filtros são combinados e equipamentos cancelados ficam ocultos por padrão. Quando não houver resultados, `totalPaginas` será `0`.

Exemplo de resposta paginada:

```json
{
  "dados": [
    {
      "id": "EQ-001",
      "codigoBarrasInterno": "COD-001",
      "tipo": "NOTEBOOK",
      "marca": "Exemplo",
      "modelo": "Notebook 14",
      "anoFabricacao": 2024,
      "estadoFisico": "BOM_ESTADO",
      "pesoQuilogramas": 2.1,
      "loteId": "LOTE-001",
      "posicaoNoLote": 1,
      "statusRastreamento": "AGUARDANDO_TRIAGEM",
      "cancelado": false,
      "motivoCancelamento": null,
      "dataCadastro": null,
      "version": 0
    }
  ],
  "total": 1,
  "pagina": 1,
  "limite": 20,
  "totalPaginas": 1
}
```

Para atualizar o cadastro, envie `version` junto com ao menos um campo permitido, por exemplo `{"version":0,"tipo":"NOTEBOOK","marca":"Exemplo"}`. A atualização cadastral não é bloqueada por triagem ou movimentações registradas; equipamentos cancelados ou vinculados a lotes cancelados não podem ser alterados. Em caso de conflito, consulte novamente o equipamento e repita a alteração com a versão mais recente.

## Parâmetros globais

Rotas exclusivas de administrador. Alíquotas e coeficiente de depreciação são frações entre 0 e 1.

| Método e rota | O que faz e dados |
| --- | --- |
| `GET /global-parameters` | Consulta versão atual. Se ainda não houver registro, retorna valores padrão. |
| `GET /global-parameters/history` | Lista versões anteriores e atuais. |
| `PATCH /global-parameters` | Cria nova versão histórica. Corpo pode conter `imposto` junto com `aliquota` (ex.: `{"imposto":"ICMS","aliquota":0.18}`), `coeficienteDepreciacao`, ou ambos. O identificador do imposto aceita 2–30 letras maiúsculas, números, hífen ou sublinhado após normalização. |

## Relatórios

Disponíveis para `ADMINISTRADOR` e `AUDITOR`.

| Método e rota | O que faz e dados |
| --- | --- |
| `GET /reports/status?status=...` | Relatório de equipamentos em um status de rastreamento. `status` é obrigatório. |
| `GET /reports/organizations/:id?inicio=...&fim=...` | Relatório da organização no período. `inicio` e `fim` são obrigatórios. |
| `GET /reports/financial?inicio=...&fim=...` | Relatório financeiro no período. `inicio` e `fim` são obrigatórios. |
| `GET /reports/audit?inicio=...&fim=...` | Eventos de auditoria no período. `inicio` e `fim` são obrigatórios. |

As rotas de relatório retornam o conteúdo textual como corpo `text/plain`, não um objeto JSON.

## Enumerações

- `papel`: `ADMINISTRADOR`, `OPERADOR_CADASTRO`, `GESTOR_ALMOXARIFADO`, `AUDITOR`.
- `tipo`: `COMPUTADOR_MESA`, `NOTEBOOK`, `MONITOR`, `IMPRESSORA`, `SERVIDOR`, `ROTEADOR`, `CABO_ESTRUTURADO`, `FONTE_ALIMENTACAO`.
- `estadoFisico`: `NOVO`, `BOM_ESTADO`, `USADO_LEVE`, `USADO_MODERADO`, `DANIFICADO_LEVE`, `DANIFICADO_GRAVE`, `INSERVIVEL`.
- `status` de rastreamento: `AGUARDANDO_TRIAGEM`, `EM_TRIAGEM`, `AGUARDANDO_DESMONTE`, `EM_DESMONTE`, `PECAS_REAPROVEITADAS`, `MATERIAL_RECICLAVEL`, `DESCARTE_SEGURO`, `BAIXA_DEFINITIVA`.
- `status` de lote: `RECEBIDO`, `EM_TRIAGEM`, `TRIAGEM_CONCLUIDA`, `ENCAMINHADO`, `FINALIZADO`.

## Onde consultar a definição completa

O OpenAPI em `GET /documentation/json` é a referência executável dos schemas e requisitos Bearer. Os detalhes de instalação, banco e variáveis ficam em [Instalação e configuração](INSTALACAO.md).
