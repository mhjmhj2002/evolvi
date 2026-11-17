-- Catálogo inicial versionado. Fonte: BCB (Participantes STR), consulta em 2026-11-08.
-- Carga idempotente por ISPB; instituições não presentes não são removidas.
INSERT INTO instituicoes_financeiras (id,nome_oficial,nome_reduzido,codigo_compe,ispb,tipo,aliases,fonte_catalogo)
VALUES
(gen_random_uuid(),'Banco Inter S.A.','Inter','077','00416968','BANCO','["Banco Inter","Inter"]','BCB Participantes STR 2026-11-08'),
(gen_random_uuid(),'Banco Santander (Brasil) S.A.','Santander','033','90400888','BANCO','["Santander"]','BCB Participantes STR 2026-11-08'),
(gen_random_uuid(),'Itaú Unibanco S.A.','Itaú','341','60701190','BANCO','["Itau","Itaú"]','BCB Participantes STR 2026-11-08'),
(gen_random_uuid(),'Banco C6 S.A.','C6','336','31872495','BANCO','["C6 Bank","C6"]','BCB Participantes STR 2026-11-08'),
(gen_random_uuid(),'Nu Pagamentos S.A.','Nubank','260','18236120','INSTITUICAO_PAGAMENTO','["Nubank","Nu"]','BCB Participantes STR 2026-11-08'),
(gen_random_uuid(),'PagSeguro Internet Instituição de Pagamento S.A.','PagBank','290','08561701','INSTITUICAO_PAGAMENTO','["PagSeguro","PagBank"]','BCB Participantes STR 2026-11-08'),
(gen_random_uuid(),'Mercado Pago Instituição de Pagamento Ltda.','Mercado Pago','323','10573521','INSTITUICAO_PAGAMENTO','["Mercado Pago"]','BCB Participantes STR 2026-11-08'),
(gen_random_uuid(),'Banco Neon S.A.','Neon',NULL,'00000000','INSTITUICAO_PAGAMENTO','["Neon"]','BCB Participantes STR 2026-11-08')
ON CONFLICT (ispb) DO UPDATE SET nome_oficial=EXCLUDED.nome_oficial,nome_reduzido=EXCLUDED.nome_reduzido,codigo_compe=EXCLUDED.codigo_compe,tipo=EXCLUDED.tipo,aliases=EXCLUDED.aliases,fonte_catalogo=EXCLUDED.fonte_catalogo,ativo=true,atualizado_em=CURRENT_TIMESTAMP;
