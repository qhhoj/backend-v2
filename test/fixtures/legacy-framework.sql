SET FOREIGN_KEY_CHECKS=0;
SET SESSION sql_mode = '';
INSERT INTO judge_taggroup (id, code, name) VALUES (501,'fw_a','A'),(502,'skip_b','B'),(503,'fw_c','C'),(504,'fw_d','D'),(505,'fw_e','A'),(506,'fw_f','F');
INSERT INTO judge_tag (id, code, name, group_id) VALUES
 (501,'fw_t1','t1',501),(502,'fw_t2','t2',501),(503,'fw_t3','t3',503),
 (504,'fw_t4','t4',504),(505,'fw_t5','t5',504),(506,'fw_t6','t6',504),(507,'fw_orphan','o',999);
SET FOREIGN_KEY_CHECKS=1;
