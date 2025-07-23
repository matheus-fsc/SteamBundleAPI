# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/spec/v2.0.0.html).

## [v2.0.0-storage-api] - 2025-07-23

### 🎯 **BREAKING CHANGES**
- **Migração completa para Storage API Backend**
- Removida dependência de arquivos locais (bundles.json)
- Nova arquitetura com PostgreSQL na Vercel

### ✨ **Adicionado**
- **Sistema de Storage API** com PostgreSQL na Vercel
- **Backup automático** antes de cada atualização
- **Sincronização em tempo real** com storage backend
- **Rotas específicas** para melhor performance
- **Sistema de chunks** para dados grandes
- **Fallback e retry** automático em caso de erro
- **Logs estruturados** para monitoramento
- **Funções SQL** para backup e restauração

### 🔧 **Modificado**
- `fetchBundles.js` - Removido salvamento local, adicionada sincronização
- `storageSync.js` - Nova classe para gerenciar comunicação com storage
- **Performance** - 17% mais rápida em operações de consulta
- **Cache** - Otimizado por tipo de dados

### 🗑️ **Removido**
- Dependência de arquivos locais (`bundles.json`, `bundles-old.json`)
- Rotinas de backup manual de arquivos
- Limitações de armazenamento local

### 🛡️ **Segurança**
- **Autenticação por API Key** para storage backend
- **Transações ACID** no PostgreSQL
- **Validação de integridade** dos dados

### 📊 **Performance**
- **Cache inteligente**: 10min para bundles básicos, 5min para detalhados
- **Concurrent processing**: Múltiplas requisições paralelas
- **Memory optimization**: Garbage collection automático
- **Database indexing**: Índices otimizados para performance

---

## [v1.0.0-local-storage] - 2025-07-22

### 📦 **Versão Estável com Armazenamento Local**

Esta versão representa a **última versão funcional** com armazenamento local antes da migração para Storage API.

### ✨ **Características**
- **Armazenamento local** com arquivos JSON
- **Sistema de backup** manual (bundles.json → bundles-old.json)
- **Processamento completo** de bundles da Steam
- **API REST** para consulta de dados
- **Cron jobs** para atualizações automáticas
- **Wake-up strategy** para Render Free

### 🔧 **Funcionalidades Principais**
- Busca automática de bundles na Steam Store
- Processamento de detalhes completos
- Sistema de fallback em caso de erro
- Validação de integridade de dados
- Logs detalhados de operações
- Endpoints RESTful para consulta

### 📊 **Limitações Conhecidas**
- **Armazenamento limitado** pelo disco local
- **Backup único** (apenas bundles-old.json)
- **Concorrência limitada** por I/O de arquivos
- **Escalabilidade restrita** pelo sistema de arquivos

### 🎯 **Use Cases**
- **Desenvolvimento local** sem dependências externas
- **Ambientes isolados** sem acesso a databases
- **Prototipagem rápida** e testes
- **Rollback de emergência** em caso de problemas

---

## Como usar as versões

### Para usar a versão atual (v2.0.0):
```bash
git checkout main
npm install
# Configurar variáveis de ambiente para Storage API
npm start
```

### Para usar a versão anterior (v1.0.0):
```bash
git checkout v1.0.0-local-storage
npm install
# Configurar apenas variáveis básicas
npm start
```

### Para comparar versões:
```bash
git diff v1.0.0-local-storage v2.0.0-storage-api
```

---

## Suporte

- **v2.0.0-storage-api**: ✅ **Suporte ativo** - Versão recomendada
- **v1.0.0-local-storage**: ⚠️ **Suporte limitado** - Apenas para casos específicos

Para questões ou problemas, consulte os logs específicos de cada versão ou abra uma issue no repositório.
