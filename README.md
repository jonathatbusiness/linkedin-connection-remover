# LinkedIn Connection Remover

Extensão experimental para Google Chrome que processa uma lista de nomes e automatiza, na página de conexões do LinkedIn, o fluxo visível de pesquisar, abrir o menu de ações, solicitar a remoção e confirmar.

> **Atenção:** remover uma conexão é uma ação real e potencialmente irreversível. Revise a lista antes de iniciar. A interface do LinkedIn pode mudar e quebrar a automação. O uso de automações também pode estar sujeito aos termos e limites da plataforma; use por sua conta e em ritmo moderado.

## Recursos da primeira versão

- Um nome por linha, com remoção automática de linhas vazias e duplicadas.
- Confirmação explícita antes de iniciar.
- Botões coloridos de **Run**, **Pause** e **Stop**.
- Processamento sequencial com pequenos intervalos aleatórios e espera automática pela interface.
- Correspondência exata, ignorando caixa, espaços repetidos e acentos.
- Proteção contra resultado ausente ou ambíguo.
- Verificação do nome novamente antes da confirmação final.
- Relatório individual de sucesso e erro.
- Estado salvo em `chrome.storage.local`.
- Painel que pode ser mostrado ou ocultado pelo ícone da extensão.

## Instalação local

1. Abra `chrome://extensions` no Chrome.
2. Ative **Developer mode** / **Modo do desenvolvedor**.
3. Clique em **Load unpacked** / **Carregar sem compactação**.
4. Selecione esta pasta do projeto.
5. Abra `https://www.linkedin.com/mynetwork/invite-connect/connections/`.
6. Clique no ícone da extensão para mostrar ou ocultar o painel. Recarregar a página após uma atualização continua sendo recomendado, mas a extensão também tenta se injetar sob demanda.

## Uso

1. Abra a página de conexões do LinkedIn.
2. Cole os nomes no painel, um por linha.
3. Clique em **Run** e confirme a quantidade exibida.
4. Use **Pause** para pausar antes da próxima etapa e **Run** para continuar.
5. Use **Stop** para impedir novas remoções. Se o modal do LinkedIn estiver aberto, a extensão tenta cancelá-lo.

O nome exibido no card precisa corresponder exatamente ao nome informado. Se nenhum card ou mais de um card corresponder, ninguém será removido naquela linha.

## Estrutura

- `manifest.json`: configuração Manifest V3.
- `background.js`: abre ou fecha o painel pelo ícone da extensão.
- `content.js`: interface, fila, validações e automação.
- `content.css`: estilo isolado pelo prefixo `lcr`.

## Seletores

A implementação evita classes CSS geradas pelo LinkedIn. Ela prioriza atributos semânticos observados na interface:

- Campo: `data-testid="typeahead-input"`.
- Card: `componentkey` iniciado por `ConnectionCard_`.
- Perfil: link contendo `/in/`.
- Ações: botão cujo `aria-label` começa com `More actions for`.
- Menu: `role="menu"` e `role="menuitem"`.
- Modal: `role="dialog"`.

Textos em inglês e português são aceitos nas ações de remoção e cancelamento.

## Limitações conhecidas

- O LinkedIn pode alterar a marcação da página sem aviso.
- A primeira versão precisa permanecer na página de conexões durante a execução.
- Fechar ou recarregar a aba interrompe o processo; a fila fica salva como pausada, mas deve ser reiniciada conscientemente.
- Não existe correspondência por URL de perfil nesta versão.
- O relatório ainda não possui exportação CSV.

## Conectar ao GitHub

Execute no Git Bash dentro desta pasta:

```bash
git init
git add .
git commit -m "feat: initial Chrome extension"
git branch -M main
git remote add origin https://github.com/jonathatbusiness/linkedin-connection-remover.git
git push -u origin main
```

Se o repositório remoto tiver recebido um README, licença ou qualquer commit criado pelo GitHub, sincronize antes do primeiro push:

```bash
git pull origin main --allow-unrelated-histories
git push -u origin main
```

## Desenvolvimento

Depois de editar os arquivos, abra `chrome://extensions`, localize a extensão, clique em **Reload** e recarregue a página do LinkedIn.

## Privacidade

A extensão não possui servidor e não envia a lista para terceiros. Os nomes e o progresso são armazenados localmente pelo Chrome. As pesquisas e remoções, naturalmente, interagem com a conta do LinkedIn aberta no navegador.

## Licença

Nenhuma licença foi definida nesta primeira versão. Adicione uma licença antes de distribuir publicamente se desejar permitir reutilização explícita do código.
