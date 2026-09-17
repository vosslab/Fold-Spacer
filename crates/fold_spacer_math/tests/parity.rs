use fold_spacer_math::{advance_distance, lane_target, residue_score, runner_collision};

#[test]
fn shared_fixture_matches_native_exports() {
    let fixture = include_str!("../../../tests/fixtures/runner_math.tsv");
    for line in fixture.lines().filter(|line| !line.starts_with('#')) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        match fields[0] {
            "advance_distance" => {
                let actual = advance_distance(parse(fields[1]), parse(fields[2]), parse(fields[3]));
                assert_close(actual, parse(fields[4]));
            }
            "lane_target" => {
                let actual = lane_target(parse(fields[1]), parse(fields[2]));
                assert_close(actual, parse(fields[3]));
            }
            "runner_collision" => {
                let actual = runner_collision(
                    parse(fields[1]),
                    parse(fields[2]),
                    parse(fields[3]),
                    parse(fields[4]),
                    parse(fields[5]),
                    parse(fields[6]),
                );
                assert_eq!(actual, parse::<u32>(fields[7]));
            }
            "residue_score" => {
                let actual = residue_score(parse(fields[1]), parse(fields[2]));
                assert_eq!(actual, parse::<u32>(fields[3]));
            }
            name => panic!("unknown fixture operation: {name}"),
        }
    }
}

fn parse<T: std::str::FromStr>(value: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    value.parse().expect("fixture value must parse")
}

fn assert_close(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() < 0.000_01,
        "{actual} != {expected}"
    );
}
