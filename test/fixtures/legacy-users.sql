SET FOREIGN_KEY_CHECKS=0;
SET SESSION sql_mode = '';
INSERT INTO auth_user (id, password, last_login, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined) VALUES
 (1001,'pbkdf2_sha256$870000$s$h','2026-01-02 03:04:05',0,'ana','Ana','','ana@example.com',0,1,'2020-01-01 00:00:00'),
 (1002,'pbkdf2_sha256$870000$s$h',NULL,0,'deact','','','deact@example.com',1,0,'2019-01-01 00:00:00'),
 (1003,'pbkdf2_sha256$870000$s$h',NULL,0,'pend','','','pend@example.com',0,0,'2019-01-01 00:00:00'),
 (1004,'pbkdf2_sha256$870000$s$h',NULL,0,'banned','','','banned@example.com',0,0,'2019-01-01 00:00:00'),
 (1005,'pbkdf2_sha256$870000$s$h',NULL,0,'norow','','','norow@example.com',0,0,'2019-01-01 00:00:00');
INSERT INTO judge_profile (id, user_id, about, timezone, points, performance_points, problem_count, display_rank, rating, current_contest_id, language_id, ban_reason, site_theme, ace_theme, math_engine, allow_tagging, display_badge_id) VALUES
 (1001,1001,'**hi**','Asia/Ho_Chi_Minh',12.5,30.25,3,'user',1500,1999,4,NULL,'dark','auto','auto',1,NULL),
 (1002,1002,NULL,'UTC',0,0,0,'user',NULL,NULL,NULL,NULL,'auto','auto','auto',1,NULL),
 (1003,1003,NULL,'UTC',0,0,0,'user',NULL,NULL,NULL,'','auto','auto','auto',1,NULL),
 (1004,1004,NULL,'UTC',0,0,0,'user',NULL,NULL,NULL,'cheating','auto','auto','auto',1,1),
 (1005,1005,NULL,'UTC',0,0,0,'user',NULL,NULL,NULL,NULL,'auto','auto','auto',1,NULL);
INSERT INTO registration_registrationprofile (id, activation_key, user_id, activated) VALUES (1002,'k1',1002,1),(1003,'k2',1003,0);
INSERT INTO auth_user_groups (id, user_id, group_id) VALUES (1001,1001,1),(1002,1001,1998);
INSERT INTO auth_user_user_permissions (id, user_id, permission_id) VALUES (1001,1001,9);
INSERT INTO judge_profile_organizations (id, sort_value, profile_id, organization_id) VALUES (1001,2,1001,1),(1002,1,1001,2);
INSERT INTO social_auth_usersocialauth (id, provider, uid, user_id, created, modified, extra_data) VALUES (1001,'github','42',1001,NOW(),NOW(),'{"login":"x","access_token":"t"}');
INSERT INTO judge_profile_badges (id, profile_id, badge_id) VALUES (1001,1001,1);
SET FOREIGN_KEY_CHECKS=1;
