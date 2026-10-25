from sqlalchemy import Connection, inspect


def add_appointment_date(connection: Connection) -> None:
    # create_all creates new tables but does not add columns to existing ones.
    columns = {column["name"] for column in inspect(connection).get_columns("cases")}
    if "appointment_date" not in columns:
        connection.exec_driver_sql("ALTER TABLE cases ADD COLUMN appointment_date DATE")


def add_appointment_time(connection: Connection) -> None:
    columns = {column["name"] for column in inspect(connection).get_columns("cases")}
    if "appointment_time" not in columns:
        connection.exec_driver_sql("ALTER TABLE cases ADD COLUMN appointment_time TIME")
    if "appointment_duration_minutes" not in columns:
        connection.exec_driver_sql("ALTER TABLE cases ADD COLUMN appointment_duration_minutes INTEGER")
