-- 1) Crée d'abord ton compte dans Supabase > Authentication > Users > "Add user" (coche "Auto Confirm").
-- 2) Remplace l'email ci-dessous puis lance ce script.
insert into public.admins (user_id)
select id from auth.users where email = 'TON-EMAIL@exemple.com'
on conflict do nothing;

select u.email from public.admins a join auth.users u on u.id = a.user_id;
