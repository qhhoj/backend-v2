SET FOREIGN_KEY_CHECKS=0;
SET SESSION sql_mode = '';
INSERT INTO judge_problemgroup (id, name, full_name) VALUES (8001,'grp8','Group 8');
INSERT INTO judge_problemtype (id, name, full_name) VALUES (8001,'type8','Type 8');
INSERT INTO judge_problem (id, code, name, time_limit, memory_limit, points, group_id, submission_source_visibility_mode, testcase_visibility_mode, testcase_result_visibility_mode, date) VALUES (8001,'p8','P8',1,65536,1000,8001,'F','O','A','2023-01-01 00:00:00');
INSERT INTO judge_problem_types (id, problem_id, problemtype_id) VALUES (8001,8001,8001);
INSERT INTO judge_blogpost (id, title, slug, visible, sticky, publish_on, content, summary, og_image, global_post, organization_id, score) VALUES
 (8001,'News','news',1,0,'2023-03-01 00:00:00','**big** news','sum','',1,NULL,3);
INSERT INTO judge_blogpost_authors (id, blogpost_id, profile_id) VALUES (8001,8001,1);
INSERT INTO judge_blogvote (id, score, blog_id, voter_id) VALUES (8001,-1,8001,2),(8002,2,8001,1);
INSERT INTO judge_comment (id, time, page, score, body, hidden, lft, rght, tree_id, level, author_id, parent_id, revisions) VALUES
 (8001,'2023-04-01 00:00:00','p:p8',2,'Hello **all**',0,1,6,8001,0,1,NULL,1),
 (8002,'2023-04-01 01:00:00','p:p8',0,'reply',1,2,5,8001,1,2,8001,0),
 (8003,'2023-04-01 02:00:00','p:p8',0,'deep',0,3,4,8001,2,1,8002,0),
 (8004,'2023-04-02 00:00:00','p:gone',0,'lost',0,1,4,8004,0,1,NULL,0),
 (8005,'2023-04-02 01:00:00','p:gone',0,'lost reply',0,2,3,8004,1,2,8004,0),
 (8006,'2023-04-03 00:00:00','b:8001',0,'nice post',0,1,4,8006,0,2,NULL,0),
 (8008,'2023-04-03 01:00:00','b:8001',0,'blog reply',0,2,3,8006,1,1,8006,0),
 (8007,'2023-04-04 00:00:00','s:p8',0,'editorial note',0,1,2,8007,0,1,NULL,0);
INSERT INTO judge_commentvote (id, score, comment_id, voter_id) VALUES (8001,1,8001,2),(8002,1,8004,2),(8003,5,8001,1),(8004,1,8006,1),(8005,1,8008,2);
INSERT INTO judge_commentlock (id, page) VALUES (8001,'p:p8'),(8002,'c:nocontest'),(8003,'p:p8'),(8004,'b:8001');
SET FOREIGN_KEY_CHECKS=1;
