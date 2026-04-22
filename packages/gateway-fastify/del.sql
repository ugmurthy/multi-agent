-- Sessions with only empty or null goals.
-- Review before running.
begin;
delete from gateway_sessions where id = '3eecaf23-eb80-4827-8edc-21cf5bc935a8';
delete from gateway_sessions where id = '626f675d-9db2-4d72-8bba-54216d59bc6a';
delete from gateway_sessions where id = 'eea09672-a3ac-49db-9ad3-473840427b8f';
delete from gateway_sessions where id = '593139f8-dcd3-473e-95ed-5b46d99da2a6';
delete from gateway_sessions where id = '2aeb8e18-8406-46df-8d6c-3b1d9875f2e6';
delete from gateway_sessions where id = '75912f94-a1d3-4220-bcae-f5e177cc8ab6';
delete from gateway_sessions where id = '5feeee66-a2b7-4aed-946c-63bf0c1c3921';
delete from gateway_sessions where id = '54dcbef4-1099-4eb8-a4d3-1763d242b33f';
delete from gateway_sessions where id = '8416f367-2d6a-4263-8e6e-660cf83b3e1b';
delete from gateway_sessions where id = '33ec72dc-2863-49f1-8e37-beff9ffc3833';
delete from gateway_sessions where id = 'ee7f480e-b64e-485f-b1df-bf9cf209be9f';
delete from gateway_sessions where id = '52179e3f-73a1-4290-b7f8-16b0fb742411';
delete from gateway_sessions where id = '1ccf4af1-b1fe-4beb-8b25-2720e86aadb4';
commit;
