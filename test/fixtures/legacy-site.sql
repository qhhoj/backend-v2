SET FOREIGN_KEY_CHECKS=0;
SET SESSION sql_mode = '';
INSERT INTO judge_problemgroup (id, name, full_name) VALUES (9001,'grp9','Group 9');
INSERT INTO judge_problemtype (id, name, full_name) VALUES (9001,'type9','Type 9');
INSERT INTO judge_problem (id, code, name, time_limit, memory_limit, points, group_id, submission_source_visibility_mode, testcase_visibility_mode, testcase_result_visibility_mode, date) VALUES (9001,'p9','P9',1,65536,1000,9001,'F','O','A','2023-01-01 00:00:00');
INSERT INTO judge_problem_types (id, problem_id, problemtype_id) VALUES (9001,9001,9001);
INSERT INTO judge_generalissue (id, issue_url) VALUES (9001,'https://x.example/page');
INSERT INTO judge_ticket (id, title, time, notes, object_id, is_open, content_type_id, user_id, is_contributive) VALUES
 (9001,'Wrong test','2023-05-01 00:00:00','n',9001,1,(SELECT id FROM django_content_type WHERE app_label='judge' AND model='problem'),1001,1),
 (9002,'Broken page','2023-05-02 00:00:00','',9001,0,(SELECT id FROM django_content_type WHERE app_label='judge' AND model='generalissue'),1002,0),
 (9003,'Contest?','2023-05-03 00:00:00','',1,1,(SELECT id FROM django_content_type WHERE app_label='judge' AND model='contest'),1002,0);
INSERT INTO judge_ticketmessage (id, body, time, ticket_id, user_id) VALUES
 (9002,'second','2023-05-01 01:00:00',9001,1002),
 (9001,'**first**','2023-05-01 00:30:00',9001,1001),
 (9003,'ghost','2023-05-01 02:00:00',9001,9999);
INSERT INTO judge_ticket_assignees (id, ticket_id, profile_id) VALUES (9001,9001,1002);
INSERT INTO django_flatpage (id, url, title, content, enable_comments, template_name, registration_required) VALUES
 (9001,'/about/','About','# Hi',0,'flatpages/about.html',0),(9002,'/about','Dup','x',0,'',0),(9003,'/a/../b/','Bad','x',0,'',1);
INSERT INTO judge_miscconfig (id, `key`, value) VALUES (9001,'motd','old'),(9002,'motd','new'),(9003,'home_page_top','{% if x %}y{% endif %}');
INSERT INTO judge_navigationbar (id, `order`, `key`, label, path, regex, lft, rght, tree_id, level, parent_id, hidden) VALUES
 (9001,1,'probs','Problems','/problems/','^/problem',1,4,9001,0,NULL,0),
 (9002,2,'subs','Subs','/submissions/','(?x) ^/submission  # list',2,3,9001,1,9001,1),
 (9003,3,'bad','Bad','/bad/','(?P<x>a',1,2,9003,0,NULL,0);
SET FOREIGN_KEY_CHECKS=1;
