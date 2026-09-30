from generate_placement import assign_zone


def test_spillover_hq_order():
    players = [
        {'id': 1, 'name': 'Higher', 'hq': 20, 'section': 'A'},
        {'id': 2, 'name': 'Lower', 'hq': 19, 'section': 'A'},
    ]
    sites = [
        {'x': 10, 'y': 10, 'ring': 71, 'angle': 0.5, 'zone': 'grass'},
        {'x': 20, 'y': 20, 'ring': 70, 'angle': 2.5, 'zone': 'grass'},
    ]
    assigned = assign_zone(players, sites, {'A': {'start': 0, 'end': 1}})
    by_id = {row['id']: row for row in assigned}
    assert by_id[1]['ring'] == 70
    assert by_id[2]['ring'] == 71
    assert {(row['x'], row['y']) for row in assigned} == {(10, 10), (20, 20)}


if __name__ == '__main__':
    test_spillover_hq_order()
    print('Alliance spillover preserves HQ proximity order')
