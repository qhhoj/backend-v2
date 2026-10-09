SET FOREIGN_KEY_CHECKS=0;
SET SESSION sql_mode = '';
INSERT INTO judge_problemgroup (id, name, full_name) VALUES (6001,'grp6','Group 6');
INSERT INTO judge_problemtype (id, name, full_name) VALUES (6001,'type6','Type 6');
INSERT INTO judge_problem (id, code, name, time_limit, memory_limit, points, group_id, submission_source_visibility_mode, testcase_visibility_mode, testcase_result_visibility_mode, date) VALUES (6001,'p6','P6',1,65536,1000,6001,'F','O','A','2022-12-01 00:00:00');
INSERT INTO judge_problem_types (id, problem_id, problemtype_id) VALUES (6001,6001,6001);
INSERT INTO judge_contest (id, `key`, name, start_time, end_time, format_name, format_config, scoreboard_visibility, points_precision) VALUES (6001,'c6','C6','2023-01-01 00:00:00','2023-01-01 05:00:00','default','{}','V',3);
INSERT INTO judge_contestproblem (id, points, partial, `order`, max_submissions, contest_id, problem_id) VALUES (6001,100,1,0,0,6001,6001);
INSERT INTO judge_contestparticipation (id, start, score, cumtime, `virtual`, format_data, contest_id, user_id, is_disqualified, tiebreaker, frozen_cumtime, frozen_score, frozen_tiebreaker) VALUES
 (6001,'2023-01-01 00:10:00',100,600,0,'{"6001": {"time": 600, "points": 100}}',6001,1,0,0,600,100,0),
 (6002,'1970-01-01 00:00:00',0,0,0,'{}',6001,2,0,0,0,0,0),
 (6003,'2023-01-01 00:10:00',0,0,0,'{}',6999,1,0,0,0,0,0),
 (6004,'2023-02-01 00:00:00',50,100,1,'{}',6001,1,0,0,100,50,0);
INSERT INTO judge_submission (id, date, time, memory, points, status, result, case_points, case_total, problem_id, user_id, language_id, contest_object_id, judged_date) VALUES
 (6001,'2023-01-01 00:20:00',0.5,1024,100,'D','AC',1,1,6001,1,4,6001,'2023-01-01 00:20:05'),
 (6002,'2023-01-01 00:21:00',0.5,1024,0,'D','WA',0,1,6999,1,4,6001,'2023-01-01 00:21:05');
INSERT INTO judge_contestsubmission (id, points, is_pretest, participation_id, problem_id, submission_id) VALUES (6001,100,0,6001,6001,6001),(6002,0,0,6001,6001,6002);
SET FOREIGN_KEY_CHECKS=1;
