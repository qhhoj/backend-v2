SET FOREIGN_KEY_CHECKS=0;
SET SESSION sql_mode = '';
INSERT INTO judge_organization (id, name, slug, short_name, about, creation_date, is_open, slots, access_code, logo_override_image, performance_points, member_count, is_unlisted) VALUES
 (2001,'Đội tuyển','dt-2001','DT','*xin chào*','2021-02-03 04:05:06',0,30,'ABC1234','/media/logo.png',2.5,5,0);
INSERT INTO judge_organization_admins (id, organization_id, profile_id) VALUES (2001,2001,1),(2002,2001,2999);
INSERT INTO judge_organizationrequest (id, time, state, reason, organization_id, user_id) VALUES
 (2001,'2022-03-04 05:06:07','A','please',2001,2),
 (2002,'2022-03-05 00:00:00','P','late',2999,2),
 (2003,'2022-03-06 00:00:00','P','',2001,3),
 (2004,'2022-03-07 00:00:00','P','join',2001,4),
 (2005,'2022-03-08 00:00:00','P','join again',2001,4),
 (2006,'2022-03-09 00:00:00','P','\n\t',2001,5),
 (2007,'2022-03-10 00:00:00','P','join after blank',2001,5);
SET FOREIGN_KEY_CHECKS=1;
