# GA4 opt-in complementa o alcance agregado

**Status:** Accepted  
**Date:** 2026-09-26  
**Deciders:** João

## Contexto

A ADR-0017 mantém os redirects comerciais em totais diários sem IDs, cookies ou eventos individuais no banco. A ADR-0068 usa Vercel Web Analytics para estimar alcance agregado sem cookies. Isso não permite responder, no nível de usuários/sessões, quantos visitantes chegaram a uma loja ou avançaram até o redirect.

## Decisão

- Manter Vercel Web Analytics para alcance agregado independente de consentimento do GA4 e manter Supabase como fonte comercial dos redirects `307` por dia, loja e plataforma.
- Adicionar GA4 exclusivamente para sessões que aceitaram analytics. O Google tag fica bloqueado antes do aceite; a preferência pode ser recusada, alterada ou revogada a qualquer momento.
- Registrar manualmente pageviews do App Router, buscas sem `search_term` e páginas de loja. Enviar `store_slug` como dimensão de evento em `page_view` apenas na rota `/loja/{slug}`. Remover query string e fragmento dos dados de localização/referrer; desativar medição otimizada para evitar pageviews duplicados, termos de busca automáticos e eventos de interação fora do funil.
- Após a validação da oferta, enviar `activation_redirect` ao Measurement Protocol junto à resposta `307`, somente se o request trouxer a preferência de consentimento aceita e os cookies de client/session do GA4. A transmissão é best-effort, ocorre em background, e não altera o redirect nem a gravação Supabase.
- Os identificadores pseudônimos são lidos da requisição e enviados ao Google para associar o evento à sessão consentida; nunca são persistidos pelo Farejo ou Supabase, nem correlacionados com Telegram. O GA4 não confirma carregamento da plataforma ou compra.
- O relatório local pode receber CSV agregado exportado das explorações GA4. Sem exportação, os valores são “indisponíveis”, nunca zeros presumidos. Se o período começar antes da coleta, o relatório identifica e exibe somente a cobertura a partir da data de início; não sugere retroatividade.

## Consequências

- O Farejo consegue analisar funis de sessão/usuário consentido; esse público é uma amostra dos visitantes e pode diferir do alcance total do Vercel.
- O consentimento explícito reduz cobertura do GA4, mas deixa a escolha sob controle do visitante e evita transmissão antes do aceite.
- Rejeitar ou revogar analytics não afeta o uso do site, os totais agregados do Vercel, os redirects ou a contagem Supabase.
- O relatório distingue visitantes estimados Vercel, usuários ativos GA4 que aceitaram e redirects `307` agregados no Supabase. Nenhuma dessas métricas representa compras concluídas.
- Publicar o banner, a página de privacidade e a configuração da propriedade é pré-requisito para habilitar a medição GA4 em produção. A redação deve passar pela revisão de privacidade aplicável antes do lançamento.

## Ações

1. Criar propriedade e fluxo GA4 de produção, configurar fuso UTC e segredo do Measurement Protocol na Vercel.
2. Publicar consentimento, instrumentação e texto de privacidade; habilitar somente em produção após os segredos e o Measurement ID existirem.
3. Validar os eventos com DebugView e gerar relatório local com CSVs agregados de exemplo e reais.
