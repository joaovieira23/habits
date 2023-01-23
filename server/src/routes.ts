import { prisma } from "./lib/prisma";
import { FastifyInstance } from "fastify";
import {z} from 'zod';
import dayjs from "dayjs";

export async function appRoutes(app: FastifyInstance) {
    app.post('/habits', async (request) => {

        const createHabitBody = z.object({
            title: z.string(),
            weekDays: z.array(
                z.number().min(0).max(6)
            )
        });

        const { title, weekDays } = createHabitBody.parse(request.body);
        
        const today = dayjs().startOf('day').toDate();
        
        await prisma.habit.create({
            data: {
                title,
                created_at: today,
                weekDays: {
                    create: weekDays.map((weekDay) => {
                        return {
                            week_day: weekDay
                        }
                    })
                }
            }
        })
    });

    app.get('/day', async (request) => {
        const getDayParams = z.object({
            date: z.coerce.date()
        });

        const { date } = getDayParams.parse(request.query);

        const parsedDate = dayjs(date).startOf('day')
        const weekDay = parsedDate.get('day')

        // Todos os hábitos possíveis naquele dia
        // Hábitos que já foram completados

        const possibleHabits = await prisma.habit.findMany({
            where: {
                created_at: {
                    lte: date,
                },
                weekDays: {
                    some: {
                        week_day: weekDay
                    }
                }
            }
        });

        const day = await prisma.day.findUnique({
            where: {
                date: parsedDate.toDate(),
            },
            include: {
                dayHabits: true,
            }
        });

        const completedHabits = day?.dayHabits.map((dayHabit) => {
            return dayHabit.habit_id
        }) ?? [];

        return {
            possibleHabits,
            completedHabits
        };

    });

    app.patch('/habits/:id/toggle', async (request) => {
        const toggleHabitParams = z.object({
            id: z.string().uuid(),
        });

        const { id } = toggleHabitParams.parse(request.params);

        const today = dayjs().startOf('day').toDate();

        let day = await prisma.day.findUnique({
            where: {
                date: today,
            }
        });

        if(!day) {
            day = await prisma.day.create({
                data: {
                    date: today
                }
            })
        };

        //day exite, ou encontramos ou criamos no banco de dados

        const dayHabit = await prisma.dayHabit.findUnique({
            where: {
                day_id_habit_id: {
                    day_id: day.id,
                    habit_id: id,
                }
            }   
        });

        if(dayHabit) {
            // remover a marcação de completo
            await prisma.dayHabit.delete({
                where: {
                    id: dayHabit.id,
                }
            })
        } else {
            
            // completar o hábito nesse dia
            await prisma.dayHabit.create({
                data: {
                    day_id: day.id,
                    habit_id: id,
                }
            });
        }

    });

    app.get('/summary', async () => {
        // amount = quantos hábitos eram POSSÍVEIS completar
        // completed = hábitos de fato completados
        // [ {date: 17/01, amount: 5, completed: 3}, {}, {}]

        // Query mais complexa, mais condições, relacionamentos => Escrever o SQL na mão (RAW), para performar e não fazer muitas querys pelo ORM

        const summary = await prisma.$queryRaw`
            SELECT 
                D.id, 
                D.date,
                (
                    SELECT 
                        cast(count(*) as float)
                    FROM day_habits DH
                    WHERE DH.day_id = D.id
                ) as completed,
                (
                    SELECT
                        cast(count(*) as float)
                    FROM habit_week_days HWD
                    JOIN habits H
                        ON H.id = HWD.habit_id
                    WHERE 
                        HWD.week_day = cast(strftime ('%w', D.date / 1000.0, 'unixepoch') as int)
                        AND H.created_at <= D.date
                ) as amount
            FROM days D
        `;

        // https://www.sqlite.org/lang_datefunc.html

        return summary;
    });
}
 