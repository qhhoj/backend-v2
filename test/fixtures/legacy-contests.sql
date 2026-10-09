SET FOREIGN_KEY_CHECKS=0;
SET SESSION sql_mode = '';
INSERT INTO judge_problemgroup (id, name, full_name) VALUES (5001,'grp5','Group 5');
INSERT INTO judge_problemtype (id, name, full_name) VALUES (5001,'type5','Type 5');
INSERT INTO judge_problem (id, code, name, time_limit, memory_limit, points, group_id, submission_source_visibility_mode, testcase_visibility_mode, testcase_result_visibility_mode, date) VALUES (5001,'cp5','CP5',1,65536,1000,5001,'F','O','A','2021-12-01 00:00:00');
INSERT INTO judge_problem_types (id, problem_id, problemtype_id) VALUES (5001,5001,5001);
INSERT INTO judge_judge (id, name, created, auth_key) VALUES (5001,'j5','2021-01-01 00:00:00','k5');
INSERT INTO judge_contesttag (id, name, color, description, full_name) VALUES (5001,'Vòng 1','#fff','',''),(5002,'vong-1','#000','','');
INSERT INTO judge_contest (id, `key`, name, description, summary, start_time, end_time, time_limit, is_visible, is_rated, rate_all, is_private, hide_problem_tags, run_pretests_only, og_image, logo_override_image, user_count, access_code, format_name, format_config, rating_ceiling, rating_floor, is_organization_private, problem_label_script, points_precision, scoreboard_visibility, virtual_count, hide_problem_authors, show_short_display, push_announcements, frozen_last_minutes, show_submission_list, scoreboard_cache_timeout, disallow_virtual, ranking_access_code, csv_ranking) VALUES
 (5001,'c5','Contest 5','**rules**','sum','2022-01-01 00:00:00','2022-01-01 03:00:00',7200000000,1,1,0,0,0,0,'','',12,'open','icpc','{"penalty": 10}',NULL,NULL,0,'',2,'V',3,0,0,0,30,1,0,0,'','Rank,Username,Full Name,Points,A,B\n1,ana,Ana,150,100,50'),
 (5002,'c5u','Ultimate 5','','','2022-02-01 00:00:00','2022-02-01 03:00:00',NULL,1,0,0,0,0,0,'og.png','',0,'','Ultimate','',NULL,NULL,0,'function(n) return string.char(64+n) end',3,'V',0,0,0,0,0,0,0,0,'',''),
 (5003,'c5f','Final 5','','','2022-03-01 00:00:00','2022-03-01 03:00:00',NULL,1,0,0,0,0,0,'','',0,'','final_submission','{"cumtime": true, "auto_judge": false}',NULL,NULL,0,'',3,'H',0,0,0,0,0,0,0,0,'rank-code','');
INSERT INTO judge_contestproblem (id, points, partial, is_pretested, `order`, output_prefix_override, max_submissions, contest_id, problem_id) VALUES
 (5001,100,1,0,7,NULL,0,5001,5001),(5002,50,1,0,1,NULL,3,5001,5999);
INSERT INTO judge_contest_authors (id, contest_id, profile_id) VALUES (5001,5001,1);
INSERT INTO judge_contest_tags (id, contest_id, contesttag_id) VALUES (5001,5001,5001),(5002,5001,5002);
INSERT INTO judge_contest_banned_judges (id, contest_id, judge_id) VALUES (5001,5001,5001);
INSERT INTO judge_contest_organizations (id, contest_id, organization_id) VALUES (5001,5001,1);
SET FOREIGN_KEY_CHECKS=1;
