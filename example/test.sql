
INSERT INTO user (user_id, nickname)
VALUES ( 1, 'irony' ), ( 2, 'peng' ), ( 3, 'likeAdmin' );

INSERT INTO bbs (bbs_id, user_id, writer)
VALUES 
	( 1, 1, 'irony' ),
	( 2, 2, 'peng' ),
	( 3, 2, 'peng' )
;

INSERT INTO lang ( bbs_id, `type`, title )
VALUES 
	( 1, 'US', 'first article'),
	( 1, 'KO', '첫글입니다'),
	( 1, 'FR', 'Ceci est le premier article'),
	( 2, 'KO', '펭의 글'),
	( 2, 'US', 'peng\'s article'),
	( 3, 'FR', 'Deuxième article de peng')
;

INSERT INTO keyword (keyword_id, word)
VALUES 
	(1, 'first'),
	(2, 'article'),
	(3, '첫글'),
	(4, 'Ceci'),
	(5, 'premier'),
	(6, '펭'),
	(7, '글'),
	(8, 'peng'),
	(9, 'Deuxième')
;

INSERT INTO lang_and_keyword (keyword_id, bbs_id, `type`, `ord`)
VALUES 
	(1, 1, 'US', 1),
	(2, 1, 'US', 2),
	(3, 1, 'KO', 1),
	(4, 1, 'FR', 1),
	(5, 1, 'FR', 2),
	(2, 1, 'FR', 3),
	(6, 2, 'KO', 1),
	(7, 2, 'KO', 2),
	(8, 2, 'US', 1),
	(2, 2, 'US', 2),
	(9, 3, 'FR', 1),
	(2, 3, 'FR', 2),
	(8, 3, 'FR', 3)
;

SELECT
	CONCAT(
		IF(LENGTH(COLUMN_COMMENT) > 0 , 
			CONCAT(
				'/** ', COLUMN_COMMENT, '\n',
				'*/\n'
			), ''
		),
		IF(ORDINAL_POSITION = 1, 
			CONCAT(
				'@PrimaryGeneratedColumn({ name: \'', COLUMN_NAME, '\', type: \'', DATA_TYPE, '\' })\n'
			),
			CONCAT(
				'@Column({ ', IF(CHARACTER_MAXIMUM_LENGTH, CONCAT('length: ', CHARACTER_MAXIMUM_LENGTH, ', '), ''),
				IF(IS_NULLABLE = 'NO', CONCAT('nullable: false'), ''),
				' })\n'
			)
		),
		CONCAT(COLUMN_NAME, IF(IS_NULLABLE = 'YES', '?', ''), ': ', DATA_TYPE, ';\n')
	)
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = ${schema_name}
	AND TABLE_NAME = ${table_name}
ORDER BY ORDINAL_POSITION ASC;
	
	