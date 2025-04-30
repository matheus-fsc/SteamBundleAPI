# SteamBundleAPI

## Deploy no Render

1. Certifique-se de que o repositório está no GitHub.
2. Configure as variáveis de ambiente no painel do Render:
   - `TIMEZONE`: `America/Sao_Paulo`
   - `PORT`: `3000` (ou deixe o Render definir automaticamente)
3. O Render detectará automaticamente o comando `start` no `package.json`.
4. Após o deploy, a API estará disponível no domínio fornecido pelo Render.